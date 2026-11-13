"""spark/sqlserver.py - Kết nối SQL Server từ driver Spark, tự quản giao dịch (Role B).

Vì sao không dùng `df.write.jdbc`: mỗi lần gọi là một kết nối và một giao dịch riêng, nên không
ghi được `scan_event` + `fraud_alert` + đổi `ticket_status` trong CÙNG MỘT giao dịch như file 13
mục C.3 yêu cầu. Ở đây driver Spark mở một kết nối JDBC (driver mssql-jdbc nạp qua
`spark.jars.packages`, giống connector Kafka) và gọi commit/rollback.

Dữ liệu đi vào và ra SQL Server dưới dạng JSON:
- Gửi danh sách (mã vé, các dòng cần ghi) bằng MỘT tham số NVARCHAR(MAX), SQL Server tách bằng
  OPENJSON. Không ghép chuỗi SQL nên không bị SQL injection, không vướng giới hạn 2100 tham số.
- Đọc kết quả bằng FOR JSON PATH: mỗi cột của câu SELECT là một mảng JSON.
"""
import json
from contextlib import contextmanager

# Driver JDBC của SQL Server, tải lần đầu từ Maven Central (bản jre11 chạy được trên Java 21).
MSSQL_JDBC_PACKAGE = "com.microsoft.sqlserver:mssql-jdbc:12.8.1.jre11"

# Mã lỗi SQL Server
TRANSIENT_ERRORS = {1205, 1222}  # deadlock, hết thời gian chờ khóa -> thử lại là được
DATA_ERRORS = {                  # dữ liệu không ghi được -> thử lại cũng vô ích
    241, 242, 245, 515, 547, 2601, 2627, 2628, 8114, 8115, 8152, 13609,
}


class SqlServer:
    """Một kết nối JDBC dùng lại qua các micro-batch. Tự nối lại nếu kết nối chết."""

    def __init__(self, spark, host, port, database, user, password, encrypt=False,
                 app_name="spark-silver", lock_timeout_ms=10000):
        self._jvm = spark.sparkContext._jvm
        self._url = (f"jdbc:sqlserver://{host}:{port};databaseName={database};"
                     f"encrypt={'true' if encrypt else 'false'};trustServerCertificate=true;"
                     f"applicationName={app_name};loginTimeout=10")
        self._user = user
        self._password = password
        self._lock_timeout_ms = int(lock_timeout_ms)
        self._conn = None
        self.describe = f"{host}:{port}/{database} (user={user})"

    # ---------- kết nối ----------
    def _new_connection(self):
        try:
            driver = self._jvm.com.microsoft.sqlserver.jdbc.SQLServerDriver()
        except TypeError as exc:  # py4j trả JavaPackage khi không thấy lớp -> "not callable"
            raise RuntimeError(
                f"Không nạp được driver JDBC của SQL Server. Kiểm tra spark.jars.packages có "
                f"{MSSQL_JDBC_PACKAGE} và máy có mạng ở lần chạy đầu.") from exc
        props = self._jvm.java.util.Properties()
        props.setProperty("user", self._user)
        props.setProperty("password", self._password)
        conn = driver.connect(self._url, props)
        conn.setAutoCommit(False)
        stmt = conn.createStatement()
        try:
            # Chờ khóa tối đa N ms rồi báo lỗi 1222 (được thử lại), thay vì treo cả batch.
            stmt.execute(f"SET LOCK_TIMEOUT {self._lock_timeout_ms}")
        finally:
            stmt.close()
        conn.commit()
        return conn

    def connect(self):
        if self._conn is not None:
            try:
                if not self._conn.isClosed() and self._conn.isValid(2):
                    return self._conn
            except Exception:  # noqa: BLE001 - kết nối hỏng kiểu gì cũng mở lại
                pass
            self.close()
        self._conn = self._new_connection()
        return self._conn

    def close(self):
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:  # noqa: BLE001
                pass
            self._conn = None

    # ---------- giao dịch ----------
    @contextmanager
    def transaction(self):
        """`with db.transaction():` - hết khối thì commit, có lỗi thì rollback rồi ném lại."""
        conn = self.connect()
        try:
            yield self
            conn.commit()
        except BaseException:
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001 - kết nối đã chết thì rollback cũng vô nghĩa
                self.close()
            raise

    # ---------- câu lệnh ----------
    def _prepare(self, sql, params):
        ps = self.connect().prepareStatement(sql)
        for i, value in enumerate(params, start=1):
            ps.setString(i, value)  # NVARCHAR (sendStringParametersAsUnicode mặc định true)
        return ps

    def query_json(self, sql, *params):
        """Chạy câu SELECT mà mỗi cột là một mảng JSON (FOR JSON PATH). Trả tuple các list."""
        ps = self._prepare(sql, params)
        try:
            rs = ps.executeQuery()
            n_cols = rs.getMetaData().getColumnCount()
            if not rs.next():
                return tuple([] for _ in range(n_cols))
            out = []
            for i in range(1, n_cols + 1):
                text = rs.getString(i)
                out.append(json.loads(text) if text else [])
            return tuple(out)
        finally:
            ps.close()

    def execute(self, sql, *params):
        """Chạy INSERT/UPDATE/DELETE. Trả số dòng bị ảnh hưởng."""
        ps = self._prepare(sql, params)
        try:
            return int(ps.executeUpdate())
        finally:
            ps.close()


def sql_error_code(exc):
    """Lấy mã lỗi SQL Server (vd 1205, 547) từ lỗi py4j. Không phải lỗi SQL Server thì trả None."""
    je = getattr(exc, "java_exception", None)
    depth = 0
    while je is not None and depth < 10:
        try:
            if je.getClass().getName().endswith("SQLServerException"):
                return int(je.getErrorCode())
            je = je.getCause()
        except Exception:  # noqa: BLE001
            return None
        depth += 1
    return None


def is_connection_error(exc):
    """Lỗi do mất kết nối (SQL Server khởi động lại, mạng Docker chập chờn)."""
    text = str(exc)
    return any(s in text for s in ("connection is closed", "Connection reset", "08S01",
                                    "TCP/IP connection", "connection has been closed"))
