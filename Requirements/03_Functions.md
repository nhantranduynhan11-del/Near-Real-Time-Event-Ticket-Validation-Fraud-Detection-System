# 03. Functional Requirements

Tài liệu liệt kê toàn bộ các chức năng của hệ thống, phân loại theo hai nhóm **Core (Nghiệp vụ cốt lõi)** và **Management (Quản trị & Giám sát)**.

---

## Danh mục chức năng hệ thống

| Function ID | Function Name | Nhóm | Actor liên quan | Mô tả ngắn | Use Case tương ứng |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **F01** | Quét và tiếp nhận lượt soát vé *(Scan Ingestion)* | Core | Gate Operator | Tiếp nhận tức thì thông tin lượt soát vé (mã vé, cổng soát vé, mã máy quét, thời điểm quét) khi nhân viên thực hiện thao tác tại cổng. | UC01 |
| **F02** | Xác thực tính hợp lệ cơ bản của vé *(Ticket Validation)* | Core | Gate Operator | Kiểm tra mã vé có tồn tại trong hệ thống, đúng định dạng, đúng sự kiện, đúng cổng được chỉ định và trạng thái hiệu lực (`UNUSED`). | UC01 |
| **F03** | Phát hiện hành vi gian lận vé *(Fraud Detection)* | Core | Event Supervisor | Tự động phát hiện các mẫu hành vi vi phạm quy định vào cửa theo thời gian thực (vé đã sử dụng trước đó quét lại, cùng một vé xuất hiện tại hai cổng khác nhau trong khoảng thời gian ngắn phi thực tế). | UC02 |
| **F04** | Trả kết quả quyết định vào cổng *(Entry Feedback)* | Core | Gate Operator | Phản hồi tín hiệu quyết định thuộc tập kết quả chuẩn (`VALID`, `INVALID`, `USED`, `CANCELLED`, `EXPIRED`, `WRONG_GATE`) trực tiếp về thiết bị soát vé của nhân viên tại cổng. | UC01 |
| **F05** | Phát tín hiệu cảnh báo gian lận *(Fraud Alerting)* | Core | Event Supervisor | Tự động bắn thông báo cảnh báo trực tiếp kèm chi tiết vi phạm lên màn hình giám sát trung tâm ngay khi phát sinh các sự kiện nghi vấn/gian lận. | UC02 |
| **F06** | Lưu vết lịch sử kiểm soát *(Event Audit Logging)* | Core | Event Supervisor | Ghi nhận toàn bộ các lượt quét thô (Bronze Layer) và lịch sử các quyết định soát vé để phục vụ công tác đối soát, tái hiện sự cố và kiểm toán sau sự kiện. | UC05 |
| **F07** | Bảng điều khiển giám sát trực tiếp *(Live Monitoring Dashboard)* | Management | Event Supervisor | Hiển thị trực quan theo thời gian thực tổng số lượt quét, lưu lượng vào theo từng cổng, tỷ lệ gian lận và danh sách cảnh báo mới nhất. | UC03 |
| **F08** | Quản lý dữ liệu sự kiện và vé *(Ticket & Event CRUD)* | Management | Event Supervisor | Cung cấp chức năng tạo mới, cập nhật, tra cứu và xóa thông tin danh mục sự kiện, cấu hình loại vé và danh mục mã vé phát hành. | UC04 |
| **F09** | Nhập danh sách vé hợp lệ *(Import Valid Ticket List)* | Management | Ticketing Partner / Event Supervisor | Cung cấp cơ chế tiếp nhận và nạp danh sách mã vé đã phát hành từ đối tác bán vé vào hệ thống trước khi sự kiện diễn ra. | UC06 |

---

## Bảng Tiêu chí Nghiệm thu (Acceptance Criteria)

| Tiêu chí | Trạng thái đạt yêu cầu |
| :--- | :--- |
| **Độ phủ chức năng** | Mỗi chức năng đều trực tiếp phục vụ giải quyết bài toán chống gian lận đa cổng hoặc quản trị dữ liệu đồ án. |
| **Tính khả thi mở rộng (Traceability)** | Toàn bộ 9 chức năng F01–F09 đều ánh xạ chính xác 1-1 với 6 Use Case đã định nghĩa tại Phase 1 (UC01–UC06). |
| **Đồng bộ định danh** | Danh mục F01 đến F09 được giữ nguyên mã định danh và thống nhất trên toàn bộ các tài liệu của dự án. |
