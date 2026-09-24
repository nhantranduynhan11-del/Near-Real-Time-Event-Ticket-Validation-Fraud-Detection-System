# 02. Stakeholder & Actor Specification

Tài liệu định nghĩa toàn bộ các bên liên quan (Stakeholders) và các tác nhân trực tiếp (Actors) tham gia tương tác với hệ thống, phân định ranh giới trách nhiệm và quy chuẩn cách gọi tên thống nhất cho toàn bộ dự án.

---

## 1. Phân loại Tổng thể Các bên liên quan (Stakeholders)

| Nhóm Stakeholder | Đại diện | Quyền lợi & Kỳ vọng đối với Hệ thống |
| :--- | :--- | :--- |
| **Đơn vị tổ chức sự kiện (Organizer)** | Ban tổ chức, Doanh nghiệp sự kiện | Bảo vệ doanh thu bán vé, ngăn chặn thất thoát do vé lậu/vé nhân bản, nắm bắt số liệu tham dự thực tế chính xác. |
| **Đội ngũ vận hành & Giám sát (Operations & Security)** | Trưởng ban an ninh, Giám sát viên sự kiện | Giám sát toàn cảnh các cổng theo thời gian thực, nhận diện kịp thời các hành vi gian lận để xử lý tại chỗ. |
| **Nhân viên soát vé (Gate Staff)** | Nhân viên trực tiếp tại các cổng kiểm soát | Thao tác quét mã nhanh chóng, nhận phản hồi quyết định (Cho vào / Từ chối) tức thì, không bị nghẽn cổng. |
| **Khán giả tham dự (Attendees)** | Khách hàng mua vé chính ngạch | Vào cửa thuận tiện, nhanh chóng; quyền lợi vé chính hãng được bảo đảm tuyệt đối. |

---

## 2. Bảng định nghĩa Chi tiết Các Tác nhân Hệ thống (System Actors)

> **Quy ước:** Chỉ những thực thể bên ngoài có tương tác hoặc trao đổi thông tin trực tiếp với hệ thống phần mềm mới được định nghĩa là **Actor**. 
> Để tránh nhập nhằng giữa con người và thiết bị phần cứng, người soát vé được chuẩn hóa là **Gate Operator** (tương ứng với `operator_id`), còn thiết bị vật lý đọc mã QR được coi là phương tiện/công cụ (`scanner_id`).

| Actor | Phân loại | Vai trò nghiệp vụ | Hành động tương tác với Hệ thống |
| :--- | :--- | :--- | :--- |
| **Gate Operator** *(Nhân viên soát vé tại cổng)* | Người dùng (Human Actor) | Trực tiếp vận hành thiết bị quét vé tại các lối vào (Gate A, B, C, D); đối chiếu kết quả phản hồi để kiểm soát quyền vào cửa của khách. | - Thao tác quét mã QR của khách qua thiết bị scanner.<br>- Nhận phản hồi kết quả xác thực tức thì (`VALID`, `INVALID`, `USED`, `CANCELLED`, `EXPIRED`, `WRONG_GATE`).<br>- Giữ lại vé hoặc từ chối cho khách vào nếu hệ thống trả kết quả vi phạm. |
| **Event Supervisor** *(Giám sát viên / Quản trị viên)* | Người dùng (Human Actor) | Giám sát toàn bộ tiến trình kiểm soát vé trên toàn hệ thống; quản trị dữ liệu vé và xử lý các sự cố an ninh. | - Đăng nhập vào giao diện giám sát trung tâm (Dashboard).<br>- Tiếp nhận các cảnh báo gian lận vé tức thời (Fraud Alerts).<br>- Theo dõi lưu lượng quét vé theo từng cổng và tỷ lệ gian lận.<br>- Thực hiện các thao tác quản trị dữ liệu: tạo mới, cập nhật, tra cứu vé và sự kiện (CRUD). |
| **Ticketing Partner** *(Hệ thống bán vé đối tác - Tùy chọn)* | Hệ thống ngoại vi (External System) | Cung cấp danh sách vé hợp lệ đã được thanh toán và phát hành trước thời điểm diễn ra sự kiện. | - Truyền dữ liệu danh sách vé phát hành vào cơ sở dữ liệu hệ thống thông qua các tập tin dữ liệu hoặc API nhập liệu. |

---

## 3. Quy chuẩn về "System" trong Thiết kế Hệ thống

* **Xác định ranh giới (Subject Boundary):** "System" (Hệ thống tiếp nhận, pipeline xử lý luồng và phát hiện gian lận) **không** được biểu diễn như một Actor trong các sơ đồ tương tác hay sơ đồ Use Case.
* **Nguyên tắc kỹ thuật:** Actor là tác nhân tác động kích hoạt hành động từ bên ngoài ranh giới hệ thống. Toàn bộ các tiến trình tiếp nhận dữ liệu, streaming qua Kafka, tính toán qua Spark Streaming và ghi dữ liệu vào kho lưu trữ (Bronze/Silver/Gold) là các thành phần xử lý nội tại của hệ thống.

---

## 4. Bảng Tiêu chí Nghiệm thu (Acceptance Criteria)

| Tiêu chí | Trạng thái đạt yêu cầu |
| :--- | :--- |
| **Tính duy nhất của vai trò** | Không có hai Actor nào có vai trò hoặc hành động tương tác chồng chéo lẫn nhau. |
| **Phân định rõ người và máy** | Chuẩn hóa tên gọi `Gate Operator` cho con người, tách biệt với định danh thiết bị phần cứng `scanner_id`. |
| **Tính đồng bộ danh xưng** | Tên gọi các Actor (`Gate Operator`, `Event Supervisor`) được áp dụng nhất quán cho toàn bộ các Phase tiếp theo. |
| **Xác định rõ ranh giới hệ thống** | Đã loại trừ "System" khỏi danh sách Actor bên ngoài theo đúng chuẩn phân tích thiết kế phần mềm. |
