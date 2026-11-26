# Ticket Control

## 1. Cài máy trắng

```powershell
wsl --install -d Ubuntu
```
Khởi động lại máy, mở **Ubuntu**, tạo tên người dùng/mật khẩu.

Cài **Docker Desktop**, vào Settings (biểu tượng bánh răng) → Resources → WSL integration, bật cho Ubuntu.

Tạo `C:\Users\<tên bạn>\.wslconfig`:
```
[wsl2]
memory=5GB
processors=4
```
```powershell
wsl --shutdown
```
Mở lại Ubuntu, kiểm tra:
```bash
docker --version
docker compose version
```

## 2. Lấy mã nguồn

```bash
cd ~
git clone https://github.com/nhantranduynhan11-del/Near-Real-Time-Event-Ticket-Validation-Fraud-Detection-System.git ticket-control
cd ticket-control
cp docker/.env.example docker/.env
nano docker/.env
```
Trong `docker/.env` (KHÔNG sửa `docker/.env.example`, tệp đó được commit lên GitHub), điền:

- `DB_PASSWORD`: mật khẩu `sa` của SQL Server, có chữ hoa, chữ thường, số và ký tự đặc biệt.
- `QR_HMAC_SECRET` và `JWT_SECRET`: mỗi biến một chuỗi sinh bằng `openssl rand -hex 32`. Cả nhóm dùng **chung** một `QR_HMAC_SECRET` thì mã QR in ở máy này mới quét được ở máy kia.

`Ctrl + o` sau đó enter để lưu sau khi nhập.
`Ctrl + x` để thoát.

Đổi cấu trúc bảng (vd. sau khi kéo `init.sql` mới) thì phải dựng lại DB, mất dữ liệu cũ:
`docker compose -f docker/docker-compose.yml --env-file docker/.env --profile full down -v`, rồi `./scripts/up.sh full`.

## 3. Cài môi trường Spark (một lần)

```bash
sudo apt update
sudo apt install -y openjdk-21-jdk-headless python3 python3-venv
java -version   # phải ra 21
```
```bash
cat >> ~/.bashrc <<'EOF'
export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-$(dpkg --print-architecture)"
export PATH="$JAVA_HOME/bin:$PATH"
EOF
source ~/.bashrc
```
```bash
cd ~/ticket-control
python3 -m venv .venv
source .venv/bin/activate
pip install -r spark/requirements.txt
python spark/check_env.py   # mọi dòng phải là [ OK ]
```

## 4. Bật hệ thống

```bash
chmod +x scripts/*.sh    # chỉ cần làm trong lần chạy đầu
./scripts/up.sh app      # SQL Server + API
./scripts/up.sh stream   # SQL Server + Kafka + Spark
./scripts/up.sh full     # tất cả (SQL Server + Kafka + Spark + API)
```
Lần đầu Spark tải gói Kafka, đợi 1-3 phút.

**Xong khi:**
```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env ps
```
mọi container `running`/`healthy`, và mở được `http://localhost:3000`.

## 4b. Mở giao diện Web và Dashboard

Khi API đã chạy (`./scripts/up.sh app` hoặc `./scripts/up.sh full`), mở trình duyệt tại `http://localhost:3000`:

| Vai trò | Tài khoản demo | Mật khẩu | Các trang sử dụng |
|---|---|---|---|
| **Event Supervisor** (Giám sát) | `supervisor` | `Demo@123` | **Dashboard** (`#dashboard`), **Quản trị vé** (`#tickets`), **In vé** (`#print`) |
| **Gate Operator** (Nhân viên cổng) | `op_gate_a`, `op_gate_b`, `op_gate_c`, `op_gate_d` | `Demo@123` | **Quét vé** (`#scan`) |

- **Cách mở Dashboard giám sát trực tiếp:**
  1. Truy cập `http://localhost:3000`, đăng nhập bằng tài khoản `supervisor` / `Demo@123`.
  2. Hệ thống tự mở tab **Dashboard** (`http://localhost:3000/app.html#dashboard`), hoặc bấm nút **Dashboard** trên thanh điều hướng.
  3. Trang Dashboard tự động gọi `GET /api/dashboard/live` mỗi 1 giây để hiển thị tổng lượt quét, số lượng theo 6 loại kết quả, tỷ lệ gian lận (chỉ tính mức `FRAUD`), biểu đồ lưu lượng theo cổng, danh sách cảnh báo mới nhất và trạng thái kết nối API.
- **Trang quét vé (`#scan`):** đăng nhập bằng `op_gate_a` (hoặc `op_gate_b`, `op_gate_c`, `op_gate_d`), chọn cổng và máy quét, bật camera quét mã QR hoặc nhập chuỗi QR vào ô nhập tay. Với lượt `USED`, màn hình phân biệt rõ bằng chữ và màu giữa **Hai người dùng chung vé** (`IMPOSSIBLE_TRAVEL`) và **Vé đã vào rồi** (`DUPLICATE_SCAN`), kèm cổng quét lần trước và số giây cách lần quét trước; với lượt `WRONG_GATE`, màn hình hiện cổng đúng của vé.

## 5. Thử một lượt quét

Chỉ chế độ `stream`/`full`, Spark đang chạy. Gửi thẳng một bản tin vào Kafka (không qua API):

```bash
./scripts/send_test_event.sh                  # hợp lệ -> vào Bronze
./scripts/send_test_event.sh --bad-json       # hỏng -> sang topic scan-events-dlq
```

Hoặc đi qua API:

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"raw_qr_payload":"TK001.demo","ticket_id":"TK001","decode_error":false,"gate_id":"GATE_A","scanner_id":"SC_A1","scanned_at":"2026-12-12T19:00:01.000+07:00"}'

sleep 10
find data/bronze -name '*.parquet'
```
Có file `.parquet` mới là đạt.

## 5b. Silver (Spark ghi `scan_event`, `fraud_alert`, đổi trạng thái vé)

`./scripts/up.sh stream` bật `spark/run_pipeline.sh`: một tiến trình Spark chạy cả Bronze và Silver.
Lần đầu Spark tải thêm driver JDBC của SQL Server. Thiết kế ở `Design/13_Bronze_Silver.md` phần D, E.

Trước ngày demo (12/12/2026) phải dời khung giờ nhận khách về quanh hiện tại, nếu không mọi vé ra `EXPIRED`:

```bash
./scripts/dev_event_window.sh now       # trả lại giờ demo: ./scripts/dev_event_window.sh demo
python3 scripts/send_scans.py TK001@GATE_A TK001@GATE_D      # gửi thẳng vào Kafka
python3 scripts/send_scans.py TK002@GATE_B@-1800 TK002@GATE_B # lượt đầu cách đây 30 phút
python3 scripts/send_scans.py FORGED:TK001@GATE_A             # QR sai chữ ký -> INVALID
python3 scripts/send_scans.py --qr TK001                      # in chuỗi QR đã ký (file 15)
```

Chuỗi QR được ký bằng `QR_HMAC_SECRET` trong `docker/.env`, nên biến này phải có, tối thiểu 32 ký tự (`openssl rand -hex 32`).

Kiểm thử Silver của Role B:

```bash
.venv/bin/python spark/tests/test_silver_logic.py   # luật Silver, không cần Docker
./scripts/test_silver.sh                            # đầu-cuối, XÓA dữ liệu quét, tắt Spark
./scripts/test_silver_restart.sh                    # kill -9 Spark giữa chừng rồi bật lại
./scripts/measure_ingestion_lag.sh                  # đo độ trễ 100 lượt -> docs/ingestion_lag.md
```

## 6. Chạy bộ kiểm thử 8 ca gian lận (TC01–TC08)

Yêu cầu hệ thống đang chạy ở chế độ `full` (`./scripts/up.sh full`) và đã cài `curl`, `jq`:

```bash
./scripts/run_test_cases.sh              # chạy đầy đủ cả 8 ca TC01..TC08
./scripts/run_test_cases.sh TC05 TC07    # chỉ chạy riêng một số ca
RESET_MODE=full ./scripts/run_test_cases.sh  # reset toàn phần (chạy reset.sh -y và bật lại Spark mỗi ca)
```

Ba ca ranh giới của B1 (cách đúng 140 000 ms ra `DUPLICATE_SCAN`, quét đúng giờ kết thúc nhận khách vẫn còn trong giờ, cổng sai thứ N−1 ra `WRONG_GATE_FRAUD` mà vé vẫn `UNUSED`) chạy riêng bằng `./scripts/test_boundaries.sh` (cần `./scripts/up.sh stream`; script xóa dữ liệu quét và tắt Spark).

Script tự động đăng nhập các tài khoản cổng, tạm thời mở khung giờ nhận khách của `EV001` nếu chạy ngoài giờ sự kiện, reset dữ liệu trước mỗi ca và in bảng tổng hợp `Expected / Actual / Kết quả` cho cả 8 ca. Báo cáo kiểm thử chi tiết nằm tại `docs/test_report.md`.

## 7. Đo tải, Đo chỉ mục (Index) và Theo dõi hệ thống (Monitoring)

### 7.1 Đo tải (B2)

Pipeline phải đang chạy liên tục (`./scripts/up.sh full` hoặc `stream`, đợi Spark in `[pipeline] Đang chạy`), khung giờ nhận khách bao trùm bây giờ:

```bash
./scripts/dev_event_window.sh now
python3 scripts/load_test.py                          # 25 lượt/giây x 120 giây = 3000 lượt
python3 scripts/load_test.py --rate 40 --duration 180 # mức khác
./scripts/dev_event_window.sh demo                    # trả lại giờ demo
```

Script gửi thẳng vào Kafka với tốc độ cố định, ghi CPU/RAM của Spark, SQL Server, Kafka, API mỗi 2 giây, rồi đọc độ trễ từng lượt từ `scan_event`. Kết quả: `docs/performance.md` (thông lượng, độ trễ TB/P50/P95/P99/lớn nhất, CPU/RAM, cấu hình máy), biểu đồ `docs/images/performance_latency.svg`, số liệu thô trong `docs/performance_data/`. Trong lúc đo, mở `http://localhost:3000/app.html#dashboard` để xem số liệu tăng dần. Đừng quét thêm trong lúc đo.

`./scripts/measure_ingestion_lag.sh` vẫn dùng được để đo nhanh 100 lượt (`docs/ingestion_lag.md`).

### 7.2 Theo dõi hệ thống (B3)

Một lệnh in ra: truy vấn chạy chậm nhất, kích thước và số dòng từng bảng, độ trễ pipeline của các lượt quét gần nhất (kèm Spark còn chạy không, còn tồn bao nhiêu bản tin, Gold có theo kịp không), và số bản tin trong DLQ chia theo lý do:

```bash
./scripts/monitor.sh              # in ra màn hình
./scripts/monitor.sh -n 500       # độ trễ tính trên 500 lượt gần nhất
./scripts/monitor.sh --save       # in ra và ghi làm ví dụ vào docs/monitoring.md
```

### 7.2a Chạy một lần mọi bước kiểm của B trên hệ thống thật

Cần máy từ 8 GB RAM, khoảng 15 phút. Script **xóa dữ liệu quét** (như `reset.sh -y`) và không commit gì:

```bash
./scripts/run_b_checks.sh            # tải 25 lượt/giây x 120 giây
./scripts/run_b_checks.sh --quick    # tải nhẹ 10 lượt/giây x 30 giây, để chạy thử trước
./scripts/run_b_checks.sh --skip-tc  # bỏ TC01-TC08
```

Thứ tự: bật `full` và reset, dời khung giờ, đo tải (B2), `monitor.sh --save` (B3), TC01–TC08 qua API (B4: điền `SPARK_DB_USER`/`SPARK_DB_PASSWORD` trước thì Spark chạy bằng `spark_user`), `test_boundaries.sh` (B1), cuối cùng reset, bật lại Spark và trả giờ demo. Log từng bước ở `logs/b_checks_<giờ>/`; cuối script in các tệp `docs/` đã đổi để xem lại rồi commit.

### 7.2b Tài khoản database riêng cho API và Spark (C3/B4)

Hệ thống áp dụng nguyên tắc **Least Privilege (quyền tối thiểu)**.

| Tài khoản | Thành phần | Phạm vi quyền |
|---|---|---|
| `api_user` | Node.js API | Quản lý vé, cập nhật sự kiện, đọc Silver và Gold |
| `spark_user` | Spark Streaming | Ghi Silver, cập nhật trạng thái vé, thực thi `dbo.usp_refresh_gold` |
| `sa` | Quản trị database | Khởi tạo, phân quyền, sao lưu và khôi phục |

API không được INSERT, UPDATE hoặc DELETE trên `scan_event`.
Spark không được UPDATE hoặc DELETE trên `scan_event`, `fraud_alert`
và không được ghi trực tiếp vào các bảng Gold.

#### Cấu hình tài khoản

Sinh hai mật khẩu riêng bằng lệnh `openssl rand -hex 32`.

Mở file `docker/.env` bằng lệnh:

```bash
nano docker/.env
```

Điền các biến sau và thay mật khẩu mẫu bằng mật khẩu vừa sinh:

```dotenv
DB_USER_API=api_user
DB_PASSWORD_API=<mat_khau_API>

SPARK_DB_USER=spark_user
SPARK_DB_PASSWORD=<mat_khau_Spark>
```

Không commit `docker/.env` hoặc mật khẩu thật lên GitHub.

#### Cơ chế khởi tạo độc lập

- `database/security_api.sql`: tạo và phân quyền cho API.
- `database/security_spark.sql`: tạo và phân quyền cho Spark.
- `database/security.sql`: gọi cả hai script bằng sqlcmd từ thư mục database.

| Cấu hình API | Cấu hình Spark | Kết quả |
|---|---|---|
| Trống cả cặp | Trống cả cặp | Không tạo tài khoản riêng |
| Điền đủ | Trống cả cặp | Chỉ khởi tạo api_user |
| Trống cả cặp | Điền đủ | Chỉ khởi tạo spark_user |
| Điền đủ | Điền đủ | Khởi tạo cả hai tài khoản |

Nếu để trống cả username và password, thành phần tương ứng sử dụng
`DB_USER` và `DB_PASSWORD`.

Nếu chỉ điền một trong hai biến, hệ thống báo lỗi cấu hình.

#### Khởi động hệ thống mới

```bash
./scripts/up.sh full
```

Với database đang có dữ liệu, áp dụng script phân quyền tương ứng
bằng tài khoản quản trị, sau đó tạo lại container API và khởi động lại Spark.

#### Thay đổi mật khẩu tài khoản đã tồn tại

Các script sử dụng IF NOT EXISTS khi tạo login.
Thay đổi mật khẩu trong docker/.env không tự động đổi mật khẩu SQL Server.

Quản trị viên cần thực hiện ALTER LOGIN bằng tài khoản sa:

```sql
ALTER LOGIN api_user WITH PASSWORD = '<mat_khau_moi_API>';
ALTER LOGIN spark_user WITH PASSWORD = '<mat_khau_moi_Spark>';
```

Sau đó đồng bộ docker/.env, tạo lại container API và khởi động lại Spark.

Chỉ khi chấp nhận mất dữ liệu cũ mới dựng lại toàn bộ hệ thống:

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env --profile full down -v
./scripts/up.sh full
```

**Cảnh báo:** down -v xóa các volume của dự án, bao gồm dữ liệu
SQL Server và Kafka. Cần sao lưu trước nếu muốn giữ dữ liệu.

#### Kiểm tra quyền Spark

Spark kiểm tra quyền bằng HAS_PERMS_BY_NAME khi khởi động.
Nếu thiếu quyền bắt buộc, Spark in câu GRANT cần thực hiện rồi dừng.

Nếu chỉ thiếu quyền EXECUTE trên dbo.usp_refresh_gold,
Spark cảnh báo vì Silver vẫn chạy nhưng Gold không được cập nhật.

### 7.3 Sinh dữ liệu lớn 300.000 dòng để đo Index (Role A)

Nạp bộ dữ liệu khoảng 300.000 dòng `scan_event` và vài nghìn vé trực tiếp bằng SQL để đo hiệu năng trước và sau khi đánh chỉ mục:

```bash
COMPOSE_PROFILES=full docker compose -f docker/docker-compose.yml --env-file docker/.env \
  exec -T sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$DB_PASSWORD" -C -I -b -d ticket_system \
  < database/generate_load_data.sql
```
Kiểm tra toàn vẹn dữ liệu bằng `database/check.sql` (phải trả 0 dòng lỗi). Báo cáo so sánh kế hoạch thực thi và `STATISTICS TIME, IO` trước/sau khi tạo index nằm tại `docs/indexing.md`.

## 8. Sao lưu và Khôi phục cơ sở dữ liệu (Backup & Restore — Role A)

Thư mục `./backup` ở gốc repo được gắn vào `/var/opt/mssql/backup` của container `sqlserver` trong `docker/docker-compose.yml`.

```bash
# 1. Sao lưu toàn bộ database ticket_system vào thư mục backup/
./scripts/backup_db.sh

# 2. Khôi phục database ticket_system từ bản sao lưu
./scripts/restore_db.sh
```

Kịch bản kiểm chứng đầy đủ (đếm số dòng các bảng → sao lưu → xóa dữ liệu giả lập sự cố → khôi phục → đếm lại khớp số dòng ban đầu) kèm thời gian sao lưu/khôi phục trên bộ dữ liệu 300.000 dòng được ghi tại `docs/backup_restore.md`.

## 9. Đưa dữ liệu về ban đầu

```bash
./scripts/reset.sh      # có hỏi xác nhận; xóa cả bản tin trong Kafka nếu Kafka đang chạy
./scripts/reset.sh -y   # bỏ qua hỏi
find data/bronze -name '*.parquet' # để kiểm tra lại, nếu không tìm thấy file thì đạt.
```

## 10. Tắt hệ thống

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env --profile full down
kill "$(cat .spark.pid)" 2>/dev/null   # nếu Spark đang chạy
```
Thêm `-v` vào lệnh `down` để xóa luôn dữ liệu SQL Server.

## 11. Lỗi hay gặp

| Lỗi | Cách xử lý |
|---|---|
| `no configuration file provided: not found` | Chưa đứng đúng thư mục gốc repo, hoặc chưa `git pull` |
| API treo, log Kafka báo `ENOTFOUND kafka` liên tục | Đang chạy `app` nhưng API đợi Kafka — dùng `stream`/`full`, hoặc chờ A sửa |
| `LỖI: chưa có môi trường ảo` khi bật Spark | Chưa tạo `.venv` — làm lại mục 3 |
| `UnknownTopicOrPartitionException` | Topic chưa có — chạy `bash scripts/create_topics.sh` |
| `DELETE failed ... QUOTED_IDENTIFIER` khi chạy `reset.sh` | Đã sửa trong `reset.sh` (cờ `-I`); tải lại bản mới nhất |
| Giờ lệch 7 tiếng | Thiếu `TZ=Asia/Ho_Chi_Minh` ở một thành phần nào đó |
| `The command 'docker' could not be found in this WSL 2 distro.` | Chưa bật `Docker Desktop`. Nếu đã bật vẫn không được thì thoát và bật lại |
