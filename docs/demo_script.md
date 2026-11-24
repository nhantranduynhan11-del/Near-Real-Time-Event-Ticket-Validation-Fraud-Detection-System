# Kịch bản Demo (10-15 phút)

| Thời gian | Bước | Hành động | Kết quả mong đợi |
| :--- | :--- | :--- | :--- |
| **0:00 - 1:00** | Khởi động | Mở terminal Ubuntu, chạy `./scripts/up.sh full` | Các container Docker đều "Up" hoặc "Healthy". Màn hình in ra "Xong. Mở http://localhost:3000" |
| **1:00 - 2:00** | Đăng nhập | Mở trình duyệt, vào `http://localhost:3000`. Đăng nhập bằng `op_gate_a` / `Demo@123` | Chuyển hướng sang trang quét vé (dành cho nhân viên). |
| **2:00 - 4:00** | Quét vé hợp lệ | Chọn cổng `GATE_A`, máy quét `SC_A1`. Quét mã QR của vé `TK001`. | Màn hình hiện màu xanh lá: **Cho vào** (VALID). |
| **4:00 - 6:00** | Gian lận: Quét lại | Vẫn dùng vé `TK001`, quét lại lần 2. | Màn hình hiện màu đỏ: **Từ chối** (USED - DUPLICATE_SCAN). |
| **6:00 - 8:00** | Gian lận: Hai người dùng chung | Giả lập quét vé `TK001` ở cổng A, sau 3 giây quét lại ở cổng D. | API trả về mã `IMPOSSIBLE_TRAVEL`. Giao diện hiện: "Hai người dùng chung vé". |
| **8:00 - 9:30** | Gian lận: Vé bị thu hồi | Quét vé `TK003`. | Màn hình hiện: **Từ chối** (CANCELLED - REVOKED_TICKET). |
| **9:30 - 11:00** | Dashboard | Đăng nhập bằng tài khoản `supervisor` / `Demo@123`. Mở tab Dashboard. | Thấy biểu đồ số lượt quét, cảnh báo mới nhất. |
| **11:00 - 13:00** | Quản trị vé | Vào trang Quản lý vé, thêm vé mới `TK008`. Thu hồi vé `TK002`. | Thông báo thành công. |
| **13:00 - 14:00** | Reset | Chạy `./scripts/reset.sh -y` trong Ubuntu. | Dữ liệu về trạng thái ban đầu. |
| **14:00 - 15:00** | Kết thúc | Tắt hệ thống: `docker compose -f docker/docker-compose.yml --profile full down` | Tất cả các container dừng hoạt động. |