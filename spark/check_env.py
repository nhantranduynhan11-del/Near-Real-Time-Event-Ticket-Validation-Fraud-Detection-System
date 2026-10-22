#!/usr/bin/env python3
"""spark/check_env.py - kiểm tra môi trường Spark trong WSL2 (Role B).

Chạy sau khi cài xong Java, Python, PySpark (xem spark/INSTALL.md):

    source .venv/bin/activate
    python spark/check_env.py

Kiểm tra theo thứ tự: Python, venv, PySpark, Java, rồi chạy thử một job Spark
nhỏ (local[2], múi giờ Việt Nam, ghi và đọc lại Parquet). Cuối cùng báo thêm
Kafka có đang lắng nghe ở localhost:9092 hay chưa (chỉ để biết, không bắt buộc).

Mã thoát: 0 nếu không có mục FAIL, 1 nếu có.
"""
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile

# ---- Phiên bản nhóm đã chốt. Đổi ở đây thì đổi cả spark/requirements.txt và INSTALL.md ----
EXPECTED_PYSPARK = "4.1.3"
SUPPORTED_JAVA = (17, 21)  # Spark 4.1 chạy trên Java 17 hoặc 21
RECOMMENDED_JAVA = 21
MIN_PYTHON = (3, 10)
SESSION_TZ = "Asia/Ho_Chi_Minh"  # file 11, mục 8
KAFKA_ADDR = ("localhost", 9092)  # đường NGOÀI Docker, file 11, mục 5

failures = 0


def report(status, label, detail=""):
    global failures
    if status == "FAIL":
        failures += 1
    print(f"[{status:^4}] {label}" + (f"  -  {detail}" if detail else ""))


def check_python():
    v = sys.version_info
    text = f"Python {v.major}.{v.minor}.{v.micro} ({sys.executable})"
    if (v.major, v.minor) >= MIN_PYTHON:
        report("OK", "Python", text)
        return True
    report("FAIL", "Python", f"{text}; cần từ {MIN_PYTHON[0]}.{MIN_PYTHON[1]} trở lên")
    return False


def check_venv():
    if sys.prefix != sys.base_prefix:
        report("OK", "Môi trường ảo (venv)", sys.prefix)
    else:
        report("WARN", "Môi trường ảo (venv)",
               "chưa kích hoạt. Chạy: source .venv/bin/activate")


def check_pyspark():
    try:
        import pyspark  # noqa: PLC0415
    except ImportError:
        report("FAIL", "PySpark", "chưa cài. Chạy: pip install -r spark/requirements.txt")
        return False
    if pyspark.__version__ == EXPECTED_PYSPARK:
        report("OK", "PySpark", f"{pyspark.__version__} ({os.path.dirname(pyspark.__file__)})")
        return True
    report("FAIL", "PySpark",
           f"đang là {pyspark.__version__}, nhóm chốt {EXPECTED_PYSPARK}. "
           "Chạy: pip install -r spark/requirements.txt")
    return False


def find_java():
    """Tìm đúng cái java mà Spark sẽ dùng: $JAVA_HOME/bin/java nếu có, không thì java trong PATH."""
    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        candidate = os.path.join(java_home, "bin", "java")
        return candidate if os.path.exists(candidate) else None
    return shutil.which("java")


def check_java():
    java_home = os.environ.get("JAVA_HOME")
    java = find_java()
    if java is None:
        where = f"JAVA_HOME={java_home} không có bin/java" if java_home else "không thấy lệnh java trong PATH"
        report("FAIL", "Java", where + ". Xem INSTALL.md, mục cài Java")
        return False
    try:
        out = subprocess.run([java, "-version"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        report("FAIL", "Java", f"không chạy được {java}: {exc}")
        return False
    text = out.stderr + out.stdout
    m = re.search(r'version "(\d+)(?:\.(\d+))?', text)
    if not m:
        report("FAIL", "Java", f"không đọc được phiên bản từ: {text.strip()[:200]}")
        return False
    major = int(m.group(1))
    if major == 1 and m.group(2):  # kiểu cũ: "1.8.0"
        major = int(m.group(2))
    full = re.search(r'version "([^"]+)"', text).group(1)
    if major not in SUPPORTED_JAVA:
        extra = " (Ubuntu 26.04 mặc định là Java 25, PySpark này chưa hỗ trợ)" if major == 25 else ""
        report("FAIL", "Java", f"đang là {full}{extra}; cần Java {' hoặc '.join(map(str, SUPPORTED_JAVA))}, "
                               f"nhóm dùng {RECOMMENDED_JAVA}")
        return False
    note = "" if major == RECOMMENDED_JAVA else f" (nhóm khuyến nghị {RECOMMENDED_JAVA})"
    report("OK", "Java", f"{full}{note} ({java})")
    if not java_home:
        report("WARN", "JAVA_HOME", "chưa đặt. Nên đặt trong ~/.bashrc để mọi người dùng cùng một Java")
    else:
        report("OK", "JAVA_HOME", java_home)
    return True


def check_spark_job():
    """Chạy một job nhỏ: local[2], múi giờ Việt Nam, ghi rồi đọc lại Parquet."""
    from pyspark.sql import SparkSession, functions as F  # noqa: PLC0415

    tmp = tempfile.mkdtemp(prefix="check_env_")
    spark = None
    try:
        spark = (SparkSession.builder.master("local[2]").appName("check_env")
                 .config("spark.sql.session.timeZone", SESSION_TZ)
                 .config("spark.ui.enabled", "false")
                 .config("spark.sql.shuffle.partitions", "2")
                 .getOrCreate())
        spark.sparkContext.setLogLevel("ERROR")

        rows = [("a", "2026-10-22T15:30:00+07:00"),
                ("b", "2026-10-22T23:59:59+07:00"),
                ("c", "2026-10-23T00:00:01+07:00")]
        df = (spark.createDataFrame(rows, ["id", "received_at"])
              .withColumn("received_at", F.to_timestamp("received_at")))

        # 1) Múi giờ: giờ/ngày hiển thị phải là giờ Việt Nam, không phải UTC.
        got = {r["id"]: r["slot"] for r in
               df.select("id", F.date_format("received_at", "yyyy-MM-dd/HH").alias("slot")).collect()}
        want = {"a": "2026-10-22/15", "b": "2026-10-22/23", "c": "2026-10-23/00"}
        if got == want:
            report("OK", "Múi giờ Spark", f"{SESSION_TZ}: 15:30+07:00 -> giờ 15 (không bị lệch UTC)")
        else:
            report("FAIL", "Múi giờ Spark", f"mong đợi {want}, nhận {got}")

        # 2) Ghi rồi đọc lại Parquet.
        path = os.path.join(tmp, "parquet_test")
        df.write.mode("overwrite").parquet(path)
        parquet_files = [f for f in os.listdir(path) if f.endswith(".parquet")]
        back = spark.read.parquet(path).count()
        if parquet_files and back == len(rows):
            report("OK", "Ghi/đọc Parquet", f"{len(parquet_files)} tệp, đọc lại đủ {back} dòng")
        else:
            report("FAIL", "Ghi/đọc Parquet", f"tệp={len(parquet_files)}, dòng đọc lại={back}")
        return True
    except Exception as exc:  # noqa: BLE001 - muốn báo mọi lỗi khởi động Spark
        report("FAIL", "Chạy thử job Spark", f"{type(exc).__name__}: {str(exc).splitlines()[0] if str(exc) else ''}")
        return False
    finally:
        if spark is not None:
            spark.stop()
        shutil.rmtree(tmp, ignore_errors=True)


def check_kafka_port():
    try:
        with socket.create_connection(KAFKA_ADDR, timeout=2):
            report("OK", "Kafka", f"đang lắng nghe ở {KAFKA_ADDR[0]}:{KAFKA_ADDR[1]}")
    except OSError:
        report("INFO", "Kafka",
               f"chưa thấy ở {KAFKA_ADDR[0]}:{KAFKA_ADDR[1]} (không sao ở bước cài đặt; "
               "bật bằng: docker compose --profile stream up -d kafka)")


def main():
    print("Kiểm tra môi trường Spark (WSL2)\n")
    python_ok = check_python()
    check_venv()
    pyspark_ok = check_pyspark()
    java_ok = check_java()
    if python_ok and pyspark_ok and java_ok:
        check_spark_job()
    else:
        report("SKIP", "Chạy thử job Spark", "bỏ qua vì còn mục FAIL ở trên")
    check_kafka_port()
    print()
    if failures:
        print(f"KẾT QUẢ: {failures} mục FAIL. Sửa theo gợi ý rồi chạy lại.")
        return 1
    print("KẾT QUẢ: môi trường sẵn sàng.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
