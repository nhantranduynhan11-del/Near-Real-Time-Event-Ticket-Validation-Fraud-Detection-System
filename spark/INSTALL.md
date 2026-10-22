# Cài môi trường Spark trong WSL2

Dành cho mọi thành viên cần chạy job Spark (chế độ `stream` và `full`, file 11 mục 7).
Spark chạy **trực tiếp trong WSL2, không đóng hộp Docker** (file 11 mục 2).

Làm hết hướng dẫn này mất khoảng 10 đến 15 phút, phần lớn là thời gian tải.

## 1. Phiên bản đã chốt

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| WSL2 + Ubuntu | Ubuntu 24.04 LTS hoặc 26.04 LTS | Repo nằm trong `~/...`, **không** để ở `/mnt/...` (file 11 mục 2) |
| Java | **OpenJDK 21** (gói `openjdk-21-jdk-headless`) | Spark 4.1 hỗ trợ Java 17 và 21. **Không dùng Java 25** (mặc định của Ubuntu 26.04) |
| Python | 3.10 trở lên, dùng bản của Ubuntu (24.04: 3.12.3, 26.04: 3.14.3) | Cài thư viện trong môi trường ảo `.venv` |
| PySpark (đã kèm Spark) | **4.1.3** (Scala 2.13, `py4j` tự cài kèm) | Ghim trong `spark/requirements.txt` |
| Connector Kafka cho Spark | `org.apache.spark:spark-sql-kafka-0-10_2.13:4.1.3` | **Không có sẵn** trong PySpark, tải lúc chạy job (`--packages`) |
| Kafka broker (Docker) | `apache/kafka:4.1.2` | Đã ghim trong `docker/kafka.service.yml` |

Ba quy tắc:

1. Không cài Java 25, không cài Spark riêng. Gói `pyspark` đã chứa sẵn Spark.
2. Không chạy `pip install` ngoài môi trường ảo.
3. Mọi người dùng **cùng** phiên bản trong bảng trên. Muốn nâng cấp thì đổi đồng thời bảng này, `spark/requirements.txt` và hằng số `EXPECTED_PYSPARK` trong `spark/check_env.py`.

## 2. Các bước cài

Tất cả lệnh chạy trong cửa sổ **Ubuntu** (WSL2), không phải PowerShell.

### Bước 0. Kiểm tra máy hiện có

```bash
lsb_release -d
python3 --version
java -version 2>&1 | head -n 1
df -h ~ | tail -n 1
```

Cần: Ubuntu 24.04 hoặc 26.04, Python từ 3.10, còn trống ít nhất 2 GB ổ đĩa. Chưa có `java` là bình thường.

### Bước 1. Cài Java 21 và công cụ tạo môi trường ảo

```bash
sudo apt update
sudo apt install -y openjdk-21-jdk-headless python3 python3-venv
java -version
```

Dòng đầu của `java -version` phải chứa `21`. Nếu máy có nhiều bản Java (ví dụ 25) và `java -version` không ra 21, chạy `sudo update-alternatives --config java` và chọn bản 21.

### Bước 2. Đặt `JAVA_HOME`

Chạy một lần (lệnh tự kiểm tra, chạy lại không bị ghi trùng):

```bash
grep -q 'JAVA_HOME' ~/.bashrc || cat >> ~/.bashrc <<'EOF'

# Spark (Project_DE_CO3127): dùng Java 21
export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-$(dpkg --print-architecture)"
export PATH="$JAVA_HOME/bin:$PATH"
EOF
source ~/.bashrc
echo "$JAVA_HOME"
which java
```

`which java` phải ra `/usr/lib/jvm/java-21-openjdk-.../bin/java`.

### Bước 3. Tạo môi trường ảo và cài PySpark

```bash
cd ~/Project_DE_CO3127
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r spark/requirements.txt
pip list | grep -iE "pyspark|py4j"
```

Phải thấy `pyspark 4.1.3` và `py4j 0.10.9.9`. Gói tải khoảng 400 đến 500 MB nên chờ vài phút.

Đảm bảo `.venv/` không bị đưa lên git:

```bash
grep -qxF '.venv/' .gitignore 2>/dev/null || echo '.venv/' >> .gitignore
```

### Bước 4. Kiểm tra

```bash
python spark/check_env.py
```

Kết quả đạt: mọi dòng là `[ OK ]` (hoặc `[INFO]` cho Kafka nếu chưa bật), cuối cùng là `KẾT QUẢ: môi trường sẵn sàng.` Lần chạy đầu mất 10 đến 20 giây để Spark khởi động.

## 3. Dùng hằng ngày

Mỗi lần mở cửa sổ Ubuntu mới, kích hoạt lại môi trường ảo trước khi chạy Spark:

```bash
cd ~/Project_DE_CO3127
source .venv/bin/activate
```

Dòng lệnh sẽ có tiền tố `(.venv)`. Thoát bằng `deactivate`.

## 4. Kết nối Kafka trong job Spark

- Spark nằm ngoài Docker nên gọi Kafka bằng đường **ngoài**: `localhost:9092` (file 11 mục 5).
- Connector Kafka phải khai khi chạy:
  `--packages org.apache.spark:spark-sql-kafka-0-10_2.13:4.1.3`
  hoặc `spark.jars.packages` trong cấu hình. Lần đầu cần mạng để tải từ Maven Central, các lần sau dùng bản đã lưu.
- Múi giờ: `spark.sql.session.timeZone=Asia/Ho_Chi_Minh` (file 11 mục 8).

## 5. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `E: Unable to locate package openjdk-21-jdk-headless` | Chưa cập nhật danh sách gói, hoặc bản Ubuntu cũ | `sudo apt update` rồi thử lại. Vẫn lỗi thì gửi kết quả `lsb_release -d` |
| `error: externally-managed-environment` | Đang `pip install` ngoài môi trường ảo | `source .venv/bin/activate` rồi chạy lại |
| `ensurepip is not available` khi tạo venv | Thiếu gói `python3-venv` | `sudo apt install -y python3-venv`, xóa `.venv` rồi tạo lại |
| `[FAIL] Java ... 25` | Đang dùng Java 25 | Cài Java 21 (Bước 1), chọn bằng `update-alternatives`, mở lại terminal |
| `JAVA_HOME ... doesn't exist` hoặc `Java gateway process exited` | `JAVA_HOME` sai hoặc chưa cài Java | Làm lại Bước 1 và 2, chạy `echo "$JAVA_HOME"` |
| `[WARN] Môi trường ảo ... chưa kích hoạt` | Quên `source .venv/bin/activate` | Kích hoạt rồi chạy lại |
| `Your hostname ... resolves to a loopback address` | Cảnh báo của Spark trong WSL2 | Bỏ qua, không ảnh hưởng |
| `Unable to load native-hadoop library` | Cảnh báo của Hadoop trên Linux | Bỏ qua, không ảnh hưởng |
| Tiến trình bị `Killed`, hoặc `OutOfMemoryError` | WSL2 thiếu RAM | `free -h`, kiểm tra `.wslconfig` (`memory=5GB`), đóng bớt ứng dụng |
| `Permission denied` trong `.venv` | Từng tạo `.venv` bằng `sudo` | `rm -rf .venv` rồi tạo lại **không** dùng `sudo` |

## 6. Làm lại từ đầu

Môi trường ảo là thư mục dùng một lần, xóa đi tạo lại không mất gì:

```bash
deactivate 2>/dev/null; rm -rf .venv
python3 -m venv .venv && source .venv/bin/activate
python -m pip install --upgrade pip && pip install -r spark/requirements.txt
```
