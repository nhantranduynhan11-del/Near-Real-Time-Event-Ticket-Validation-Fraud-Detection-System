# Quy trình Sao lưu và Khôi phục Cơ sở dữ liệu (`ticket_system`)

Tài liệu này mô tả cơ chế, hướng dẫn thực hiện từng bước và kết quả kiểm chứng thực tế quy trình sao lưu (backup) – khôi phục (restore) cơ sở dữ liệu SQL Server `ticket_system` trên tập dữ liệu tải 300.000 lượt quét.

---

## 1. Tổng quan & Cấu hình lưu trữ

- **Hệ quản trị CSDL:** SQL Server chạy trong container `sqlserver` (thuộc profile `full` trong `docker/docker-compose.yml`).
- **Ánh xạ thư mục sao lưu:** Thư mục `database/backup/` trên máy chủ (host) được gắn (bind mount) vào đường dẫn `/var/opt/mssql/backup` bên trong container.
- **Loại trừ khỏi Git:** Đường dẫn `database/backup/` đã được khai báo trong `.gitignore` để ngăn các tệp `.bak` dung lượng lớn bị commit lên kho mã nguồn.
- **Cơ chế an toàn dữ liệu:**
  - Sao lưu sử dụng `WITH FORMAT, INIT, COMPRESSION, CHECKSUM` và tự động chạy `RESTORE VERIFYONLY ... WITH CHECKSUM` ngay sau khi ghi xong để kiểm tra tính toàn vẹn.
  - Khôi phục tự động xác thực lại tệp `.bak` trước khi chuyển database sang chế độ `SINGLE_USER WITH ROLLBACK IMMEDIATE`, thực hiện `RESTORE DATABASE ... WITH REPLACE, RECOVERY` và khôi phục lại chế độ `MULTI_USER` (kể cả khi xảy ra lỗi trong khối `TRY...CATCH`).
- **Các script tự động hóa:**
  - `scripts/backup_db.sh`: Sao lưu toàn bộ database ra tệp `.bak`.
  - `scripts/restore_db.sh`: Khôi phục database từ một tệp `.bak` chỉ định hoặc tệp mới nhất.
  - `scripts/demo_backup_restore.sh`: Chạy khép kín quy trình đếm dòng $\rightarrow$ sao lưu $\rightarrow$ giả lập sự cố $\rightarrow$ khôi phục $\rightarrow$ đối chiếu lại toàn bộ 12 bảng và xuất log.

---

## 2. Điều kiện tiên quyết & Xử lý lỗi thường gặp

### 2.1. Yêu cầu môi trường
1. Hệ thống Docker và container `sqlserver` đang chạy ở chế độ `full`:
   ```bash
   ./scripts/up.sh full
   ```
2. Tệp biến môi trường `docker/.env` đã tồn tại và chứa `MSSQL_SA_PASSWORD`.
   > **Lưu ý kỹ thuật:** Các lệnh `docker compose exec` trong 3 script đều đã truyền tường minh `COMPOSE_PROFILES=full` và `--env-file docker/.env` (đồng bộ với `scripts/run_test_cases.sh`) để tránh lỗi không tìm thấy service `sqlserver`.
3. Các script đã được cấp quyền thực thi:
   ```bash
   chmod +x scripts/backup_db.sh scripts/restore_db.sh scripts/demo_backup_restore.sh
   ```

### 2.2. Xử lý lỗi quyền thư mục `database/backup/` (`chmod 777`)
Nếu Docker Compose tự khởi tạo thư mục `database/backup/` trước khi chạy script, thư mục này sẽ thuộc quyền sở hữu của `root`. Khi đó lệnh `chmod 777 database/backup` trong `backup_db.sh` sẽ thất bại do người dùng hiện tại không có quyền thay đổi phân quyền.

**Cách khắc phục:** Chuyển quyền sở hữu thư mục về người dùng hiện tại rồi chạy lại script:
```bash
mkdir -p database/backup
sudo chown "$USER" database/backup
```

---

## 3. Hướng dẫn thực hiện từng bước

### 3.1. Sao lưu thủ công
Chạy từ thư mục gốc của dự án:
```bash
# Tạo tệp sao lưu mặc định: database/backup/ticket_system_<YYYYMMDD_HHMMSS>.bak
./scripts/backup_db.sh

# Hoặc chỉ định tên tệp cụ thể (phải kết thúc bằng .bak)
./scripts/backup_db.sh ticket_system_truoc_nang_cap.bak
```

### 3.2. Khôi phục thủ công
> **Cảnh báo:** Thao tác này **ghi đè toàn bộ** cơ sở dữ liệu `ticket_system` hiện có và ngắt tất cả các kết nối đang mở.

```bash
# Khôi phục từ tệp .bak mới nhất trong database/backup/
./scripts/restore_db.sh

# Hoặc chỉ định một tệp .bak cụ thể trong database/backup/
./scripts/restore_db.sh ticket_system_truoc_nang_cap.bak
```

**Bước bắt buộc sau khi khôi phục:** Vì quá trình khôi phục chuyển database sang `SINGLE_USER WITH ROLLBACK IMMEDIATE`, các kết nối cũ từ API và Spark Streaming sẽ bị ngắt. Cần khởi động lại các dịch vụ ứng dụng để thiết lập kết nối mới (hoặc chạy lại `./scripts/up.sh full`).

### 3.3. Chạy kiểm thử tự động toàn quy trình (Sao lưu $\rightarrow$ Sự cố $\rightarrow$ Khôi phục)
Để kiểm chứng trên tập dữ liệu 300.000 dòng:

1. **(Tùy chọn) Sinh dữ liệu tải 300.000 lượt quét nếu DB chưa có:**
   ```bash
   COMPOSE_PROFILES=full docker compose -f docker/docker-compose.yml --env-file docker/.env \
     exec -T sqlserver bash -c \
     '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -I -b -d ticket_system' \
     < database/generate_load_data.sql
   ```
2. **Xóa log cũ (nếu muốn ghi mới hoàn toàn) và chạy demo:**
   ```bash
   rm -f docs/backup_restore_log.txt

   # Mặc định giả lập sự cố xóa sạch dữ liệu cả 12 bảng (DISASTER=delete)
   ./scripts/demo_backup_restore.sh --yes

   # Hoặc giả lập sự cố xóa hẳn database (DROP DATABASE)
   DISASTER=drop ./scripts/demo_backup_restore.sh --yes
   ```
   Log chi tiết của phiên chạy được lưu tự động tại `docs/backup_restore_log.txt`.

---

## 4. Kết quả đo thực tế trên bộ dữ liệu 300.000 dòng

Thử nghiệm được thực hiện vào ngày **26/11/2026** trên máy `DESKTOP-3Q8JVD0` sau khi đã nạp đầy đủ bộ dữ liệu từ `database/generate_load_data.sql`.

### 4.1. Quy mô dữ liệu và thời gian thực thi

| Hạng mục đo | Kết quả thực tế | Ghi chú |
| :--- | :--- | :--- |
| Số dòng bảng `scan_event` | **300.000 dòng** | Bộ dữ liệu tải chuẩn |
| Tổng số dòng toàn DB (12 bảng) | **896.664 dòng** | Gồm 295.750 `fraud_alert`, 295.750 `gold_alert`, 5.007 `ticket`, ... |
| Tổng số trang dữ liệu SQL Server | **32.282 pages** | 32.280 pages dữ liệu + 2 pages transaction log |
| Dung lượng tệp `.bak` (đã nén) | **84,57 MB** | Bật tùy chọn `COMPRESSION` |
| Thời gian ghi sao lưu (SQL Server) | **0,453 giây** | Tốc độ 556,731 MB/giây |
| Thời gian sao lưu tổng (`backup_db.sh`) | **1,979 giây** | Bao gồm `RESTORE VERIFYONLY WITH CHECKSUM` |
| Thời gian bước 2 trong demo | **2,022 giây** | Tổng thời gian gọi script từ `demo_backup_restore.sh` |
| Thời gian nạp khôi phục (SQL Server) | **0,652 giây** | Tốc độ 386,808 MB/giây |
| Thời gian khôi phục tổng (`restore_db.sh`) | **2,457 giây** | Bao gồm kiểm tra tệp, `SINGLE_USER`, khôi phục, `MULTI_USER` |
| Thời gian bước 4 trong demo | **2,482 giây** | Tổng thời gian gọi script từ `demo_backup_restore.sh` |
| Đối chiếu dữ liệu sau khôi phục | **12/12 bảng khớp** | Không mất mát hay sai lệch bản ghi nào |

---

## 5. Nhật ký chạy thực tế (`demo_backup_restore.sh`)

```text
==============================================================
Demo sao lưu và khôi phục: 2026-11-26 20:37:27  máy: DESKTOP-3Q8JVD0
Database: ticket_system   Kiểu sự cố: delete   Tệp sao lưu: ticket_system_demo_20261126_203727.bak

Bước 1. Đếm số dòng các bảng trước khi sao lưu
  app_user                      5
  event_gate                    6
  event                         2
  fraud_alert              295750
  gate_travel_time             12
  gate                          4
  gold_alert               295750
  gold_event_stats            120
  gold_gate_stats               4
  scan_event               300000
  scanner                       4
  ticket                     5007
  TỔNG                     896664

Bước 2. Sao lưu
25 percent processed.
50 percent processed.
75 percent processed.
100 percent processed.
Processed 32280 pages for database 'ticket_system', file 'ticket_system' on file 1.
Processed 2 pages for database 'ticket_system', file 'ticket_system_log' on file 1.
BACKUP DATABASE successfully processed 32282 pages in 0.453 seconds (556.731 MB/sec).
The backup set on file 1 is valid.
Sao lưu xong: /home/lenovo/Near-Real-Time-Event-Ticket-Validation-Fraud-Detection-System-main/database/backup/ticket_system_demo_20261126_203727.bak
Dung lượng tệp: 84.57 MB
Thời gian sao lưu (gồm kiểm tra tệp): 1.979 giây

Bước 3. Giả lập sự cố: delete

(295750 rows affected)

(295750 rows affected)

(300000 rows affected)

(4 rows affected)

(120 rows affected)

(5007 rows affected)

(4 rows affected)

(12 rows affected)

(6 rows affected)

(5 rows affected)

(4 rows affected)

(2 rows affected)
  Sau khi xóa, tổng số dòng còn lại: 0 (phải là 0)

Bước 4. Khôi phục
Khôi phục từ ticket_system_demo_20261126_203727.bak ...
The backup set on file 1 is valid.
25 percent processed.
50 percent processed.
75 percent processed.
100 percent processed.
Processed 32280 pages for database 'ticket_system', file 'ticket_system' on file 1.
Processed 2 pages for database 'ticket_system', file 'ticket_system_log' on file 1.
RESTORE DATABASE successfully processed 32282 pages in 0.652 seconds (386.808 MB/sec).
Khôi phục xong.
Thời gian khôi phục (gồm kiểm tra tệp): 2.457 giây
Nhớ khởi động lại API và Spark vì kết nối cũ đã bị ngắt.

Bước 5. Đếm lại và so khớp với bước 1
  Bảng                 Trước        Sau  Kết quả
  app_user                      5          5  Khớp
  event_gate                    6          6  Khớp
  event                         2          2  Khớp
  fraud_alert              295750     295750  Khớp
  gate_travel_time             12         12  Khớp
  gate                          4          4  Khớp
  gold_alert               295750     295750  Khớp
  gold_event_stats            120        120  Khớp
  gold_gate_stats               4          4  Khớp
  scan_event               300000     300000  Khớp
  scanner                       4          4  Khớp
  ticket                     5007       5007  Khớp

Thời gian sao lưu : 2.022 giây
Thời gian khôi phục: 2.482 giây
KẾT LUẬN: số dòng của cả 12 bảng khớp hoàn toàn trước và sau khôi phục.
```
