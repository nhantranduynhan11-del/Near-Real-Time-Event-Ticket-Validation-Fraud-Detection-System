# Ticket Control

Hệ thống kiểm vé tại cổng, phát hiện vé dùng chung giữa các cổng. API + Kafka + Spark + SQL Server.
Thiết kế nằm ở `Design/`, yêu cầu nằm ở `Requirements/`.

## 1. Cài đặt (máy trắng, Windows 10/11)

1. **WSL2 + Ubuntu.** Mở PowerShell bằng quyền Administrator:
   ```powershell
   wsl --install -d Ubuntu
   ```
   Khởi động lại máy, mở Ubuntu, tạo tên người dùng và mật khẩu.
2. Tải **Docker Desktop.**, vào *Settings → Resources → WSL integration*, bật cho Ubuntu.
3. **Giới hạn RAM của WSL2.** Tạo file `C:\Users\<tên bạn>\.wslconfig`:
   ```
   [wsl2]
   memory=5GB
   processors=4
   ```
   Rồi chạy `wsl --shutdown` trong PowerShell và mở lại Ubuntu.
Đến đây là xong phần cái đặt.

## 2. Lấy mã nguồn

Làm trong Ubuntu. **Để repo trong thư mục home của WSL2** (ví dụ `~/ticket-control`).

```bash
git clone https://github.com/nhantranduynhan11-del/Near-Real-Time-Event-Ticket-Validation-Fraud-Detection-System.git ~/ticket-control
cd ~/ticket-control
cp docker/.env.example docker/.env
```
nano docker/.env.example 

sau khi mở `.env`, điền các biến còn trống:

- `DB_PASSWORD`: tối thiểu 8 ký tự, có chữ hoa, chữ thường, số và ký hiệu (SQL Server không khởi động nếu yếu).
- `QR_HMAC_SECRET`: chuỗi bất kỳ, giống nhau giữa các máy là tốt nhất.

ctrl + o -> Enter
Ctrl + x
## Nhớ cài Spark (phần của ông Nhân)

## 3. Chạy

```bash
chmod +x scripts/*.sh
./scripts/up.sh app      # SQL Server + API. Dùng hằng ngày. (tạm thời bỏ qua dòng này, nếu lỡ nhập vào thì mấy ông ctrl + c để out khỏi trạng thái treo rồi gõ lệnh tiếp theo nha)
./scripts/up.sh stream   # SQL Server + Kafka + Spark. Không có API.
./scripts/up.sh full     # Tất cả. Dùng khi ghép nối và demo.
./scripts/create_topics.sh -> tạo topic Kafka
```


**Xong khi:**

- `docker compose ps`: các dịch vụ `running`/`healthy`; `db-init` ở trạng thái `exited (0)` là đúng.
- Mở <http://localhost:3000>: trang hiện trạng thái API, SQL Server, Kafka (chế độ `app` thì Kafka báo không kết nối, bình thường).

## 4. Thử một lượt quét

curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"raw_qr_payload":"TK001.demo","ticket_id":"TK001","decode_error":false,"gate_id":"GATE_A","scanner_id":"SC_A1","scanned_at":"2026-12-12T19:00:01.000+07:00"}'

sleep 10 #cho máy có thời gian ghi

Kiểm tra bản tin đã vào Bronze:

```bash
find data/bronze -name '*.parquet'
```

Có tệp mới trong `data/bronze/scan_events/year=…/month=…/day=…/hour=…/` là đạt. Riêng phần này trong dự án tui chưa thấy có thao tác ghi parquet nên tui không thể test reset bằng repo chính thức này.

## 5. Đưa dữ liệu về ban đầu

```bash
./scripts/reset.sh
```

Xóa mọi lượt quét và cảnh báo, trả 7 vé mẫu về trạng thái đầu, xóa `data/bronze/` và checkpoint của Spark. Thêm `-y` để bỏ qua câu hỏi xác nhận.

## 6. Tắt

```bash
docker compose --profile full down      # giữ dữ liệu
docker compose --profile full down -v   # xóa luôn dữ liệu SQL Server
kill "$(cat .spark.pid)"                # nếu Spark do up.sh bật
```
