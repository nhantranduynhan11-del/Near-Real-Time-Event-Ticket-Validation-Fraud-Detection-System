# Kịch bản Demo (10-15 phút)

| Thời gian | Bước | Hành động | Nói gì | Kết quả mong đợi |
| :--- | :--- | :--- | :--- | :--- |
| **0:00 - 1:00** | Khởi động & Chuẩn bị | Chạy `./scripts/up.sh full`, sau đó chạy `./scripts/dev_event_window.sh now` | "Hệ thống đã sẵn sàng, khung giờ sự kiện được đưa về hiện tại để demo." | Container healthy, API báo xanh. |
| **1:00 - 2:00** | Đăng nhập | Vào `localhost:3000`, đăng nhập `op_gate_a` / `Demo@123` | "Nhân viên soát vé đăng nhập vào hệ thống." | Chuyển sang trang quét. |
| **2:00 - 4:00** | Quét vé hợp lệ | Quét vé `TK001` tại `GATE_A`. | "Vé hợp lệ, hệ thống cho phép vào." | Màu xanh: **VALID**. |
| **4:00 - 5:30** | Gian lận: Quét lại | Vẫn vé `TK001`, quét lại lần 2. | "Vé đã vào rồi, quét lại sẽ bị chặn." | Màu đỏ: **USED - DUPLICATE_SCAN**. |
| **5:30 - 7:30** | Gian lận: Dùng chung vé | Dùng vé `TK006` (chưa quét). Quét ở `GATE_A`, sau 3s quét ở `GATE_D`. | "Hai người dùng chung vé ở 2 cổng khác nhau, thời gian di chuyển không thể nhanh vậy." | Mã `IMPOSSIBLE_TRAVEL`. |
| **7:30 - 8:30** | Gian lận: Vé giả/sai sự kiện | Quét vé `TK005` (của EV002). | "Vé của sự kiện khác, không có giá trị." | Màu đỏ: **INVALID**. |
| **8:30 - 9:30** | Gian lận: Sai cổng | Quét vé `TK007` tại `GATE_A`. | "Vé được gán cho cổng C, quét ở cổng A sẽ bị từ chối." | Màu vàng/cam: **WRONG_GATE**. |
| **9:30 - 11:00** | Dashboard | Đăng nhập `supervisor` / `Demo@123` -> Xem Dashboard. | "Dashboard cập nhật số liệu thời gian thực." | Thấy biểu đồ, cảnh báo. |
| **11:00 - 13:00** | Quản trị vé | Vào Quản lý vé, sửa/xóa vé. Thử xóa vé đã quét (bị lỗi 409). | "Hệ thống bảo vệ dữ liệu, vé đã quét không thể xóa." | Báo lỗi `TICKET_IN_USE`. |
| **13:00 - 14:00** | Reset | Chạy `./scripts/reset.sh -y`, sau đó `./scripts/up.sh full` và `./scripts/dev_event_window.sh now`. | "Đưa hệ thống về ban đầu. Lưu ý: reset sẽ tắt Spark nên phải bật lại." | Dữ liệu về 7 vé mẫu. |
| **14:00 - 15:00** | Kết thúc | Chạy `./scripts/dev_event_window.sh demo` (trả lại giờ cũ) và `docker compose down`. | "Kết thúc buổi demo." | Tắt hệ thống. |