# Tài liệu Bảo mật Hệ thống (Role C)

## 1. Phân quyền Database (Least Privilege)
Hệ thống không dùng tài khoản `sa` cho ứng dụng. Thay vào đó, chia làm 2 tài khoản riêng biệt được định nghĩa trong `database/security.sql`:
- **`api_user`**: Chỉ được đọc `scan_event`, `gold_*`. Đọc/Ghi `ticket`, `event`, `gate`. **Không được ghi** `scan_event`.
- **`spark_user`**: Đọc/Ghi `scan_event`, `fraud_alert`, `gold_*`. Chỉ đọc `ticket`.

**Bằng chứng từ chối truy cập:**
*(Chèn ảnh chụp màn hình lỗi The INSERT permission was denied ở bước C3 vào đây)*

## 2. Chữ ký số trên mã QR (Chống vé giả)
- Mỗi mã QR được sinh ra theo công thức: `<ticket_id>.<chữ_ký_HMAC>`.
- Chữ ký được tạo bằng thuật toán `HMAC-SHA256` với Secret Key (`QR_HMAC_SECRET`) nằm trong biến môi trường.
- Khi quét, API sẽ kiểm tra lại chữ ký. Nếu sai, hệ thống đánh dấu `decode_error = true` và chuyển cho Spark xử lý như vé giả (`INVALID_QR`).

## 3. Xác thực và Phân quyền (JWT)
- Người dùng đăng nhập qua `POST /api/login` và nhận về một chuỗi JWT Token (hạn 12 giờ).
- Token chứa `user_id` và `role` (`GATE_OPERATOR` hoặc `EVENT_SUPERVISOR`).
- Mọi API (trừ login) đều có Middleware kiểm tra Token. Nếu thiếu/sai token trả `401`. Nếu sai vai trò trả `403`.

## 4. Mã hóa mật khẩu
- Mật khẩu người dùng trong bảng `APP_USER` không bao giờ lưu dạng văn bản thuần (plaintext).
- Sử dụng thư viện `bcrypt` (với salt) để băm mật khẩu. Khi đăng nhập, hệ thống dùng `bcrypt.compare` để kiểm tra.

## 5. Bảo vệ thông tin nhạy cảm
- Các thông tin như `DB_PASSWORD`, `JWT_SECRET`, `QR_HMAC_SECRET` được lưu trong file `.env`.
- File `.env` đã được thêm vào `.gitignore`, không bao giờ bị đẩy lên GitHub.