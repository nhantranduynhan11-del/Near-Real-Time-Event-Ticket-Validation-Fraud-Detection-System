# 05 — Use Cases (Phase 1 · 1.1)

## UC01 — Scan Ticket at Gate (Quét vé tại cổng)

| | |
|---|---|
| **Actor** | Gate Operator |
| **Function liên quan** | F01 (Scan Ingestion), F02 (Ticket Validation), F04 (Entry Feedback) |
| **Precondition** | Gate Operator đã được gán vào một gate cụ thể (Gate A/B/C/D); thiết bị quét kết nối ổn định tới hệ thống |

**Main flow**
1. Gate Operator quét mã QR trên vé của khách tại gate được phân công.
2. Hệ thống tiếp nhận lượt soát vé: `raw_qr_payload`, `gate_id`, `scanner_id`, `scanned_at` (F01).
3. Hệ thống giải mã QR thành `ticket_id`; nếu giải mã thất bại → trả kết quả **`INVALID`** ngay, dừng flow.
4. Hệ thống tra `ticket_status` hiện tại của vé và đối chiếu tuần tự theo thứ tự đề xuất:
   a. Vé đang ở `CANCELLED` → trả **`CANCELLED`**.
   b. Vé đang ở `UNUSED` nhưng đã hết thời gian nhận khách của sự kiện → trả **`EXPIRED`**.
   c. Vé đang ở `VALID_ENTRY` (đã từng quét hợp lệ trước đó) → trả **`USED`**.
   d. Vé còn giới hạn cổng (`ticket_assigned_gate_id`) và `gate_id` hiện tại không khớp → trả **`WRONG_GATE`**.
   e. Không rơi vào trường hợp nào ở trên → trả **`VALID`**.
5. Hệ thống trả kết quả về thiết bị của Gate Operator (F04):
   - `VALID` → cho khách vào, `ticket_status` chuyển từ `UNUSED` sang `VALID_ENTRY`.
   - Mọi kết quả khác → từ chối vào.

**Exception flow**
- Kết quả `USED` (quét trùng vé đang `VALID_ENTRY`) → `ticket_status` chuyển sang `FLAGGED_FRAUD`, chuyển sang **UC02** để Event Supervisor nhận cảnh báo `DUPLICATE_SCAN`.
- Kết quả `INVALID`, `CANCELLED`, `WRONG_GATE` → `ticket_status` không đổi, chuyển sang **UC02** để Event Supervisor nhận cảnh báo tương ứng.
- Kết quả `EXPIRED` → từ chối vào, `ticket_status` không đổi (vẫn `UNUSED`), **không** sinh fraud alert.

**Postcondition** — Đúng một trong 6 scan result được ghi nhận cho lượt quét; `ticket_status` chỉ đổi khi kết quả là `VALID` (UNUSED → VALID_ENTRY) hoặc `USED` (VALID_ENTRY → FLAGGED_FRAUD).

---

## UC02 — Receive Fraud Alert (Nhận cảnh báo gian lận)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F03 (Fraud Detection), F05 (Fraud Alerting) |
| **Precondition** | Event Supervisor đã đăng nhập dashboard giám sát trung tâm |

**Main flow**
1. Một lượt quét ở UC01 trả về kết quả thuộc nhóm sinh alert.
2. Hệ thống ánh xạ kết quả sang mã cảnh báo theo đúng bảng của 07:

   | Scan result | Fraud alert code |
   |---|---|
   | `INVALID` | `INVALID_QR` |
   | `USED` | `DUPLICATE_SCAN` |
   | `CANCELLED` | `REVOKED_TICKET` |
   | `WRONG_GATE` | `WRONG_GATE` |

3. Hệ thống bắn cảnh báo lên dashboard gần như ngay lập tức, kèm `ticket_id`, `gate_id`, và với `USED`/`WRONG_GATE` là thông tin đối chiếu lượt quét trước (`previous_scan_gate_id`, `time_since_previous_scan_ms`).
4. Event Supervisor nhận cảnh báo, xem chi tiết.
5. Event Supervisor điều phối xử lý tại hiện trường (ngoài phạm vi hệ thống).

**Exception flow**
- Kết quả là `EXPIRED` hoặc `VALID` → không vào UC02, không sinh alert.

**Postcondition** — Cảnh báo xuất hiện trên dashboard trong vài giây kể từ lượt quét gây ra vi phạm.

---

## UC03 — Monitor Live Dashboard (Giám sát trực tiếp)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F07 (Live Monitoring Dashboard) |
| **Precondition** | Event Supervisor đã đăng nhập; dashboard kết nối được tới dữ liệu đã xử lý |

**Main flow**
1. Event Supervisor mở dashboard giám sát trong lúc sự kiện diễn ra.
2. Dashboard hiển thị theo thời gian thực: tổng lượt quét, phân bố theo từng scan result, tỷ lệ gian lận, danh sách cảnh báo mới nhất.
3. Event Supervisor theo dõi liên tục để nắm tình hình vận hành các cổng.

**Exception flow**
- Mất kết nối giữa dashboard và nguồn dữ liệu → dashboard hiển thị trạng thái "mất kết nối", giữ lại số liệu gần nhất đã tải.

**Postcondition** — Event Supervisor có bức tranh tổng thể, cập nhật liên tục.

---

## UC04 — Manage Ticket & Event Data (Quản lý dữ liệu sự kiện và vé)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F08 (Ticket & Event CRUD) |
| **Precondition** | Event Supervisor đã đăng nhập với quyền quản trị |

**Main flow**
1. Event Supervisor chọn thao tác: tạo mới, cập nhật, tra cứu hoặc xóa dữ liệu sự kiện / loại vé / vé phát hành.
2. Hệ thống hiển thị form hoặc kết quả tương ứng.
3. Event Supervisor xác nhận thao tác.
4. Hệ thống cập nhật dữ liệu, bao gồm cả chuyển `ticket_status` sang `CANCELLED` khi thu hồi vé.

**Exception flow**
- Dữ liệu nhập không hợp lệ (thiếu trường bắt buộc, trùng ID) → hệ thống từ chối lưu, báo lỗi cụ thể.
- Xóa dữ liệu đang được tham chiếu (VD: sự kiện đã có vé phát hành) → hệ thống cảnh báo và yêu cầu xác nhận, hoặc từ chối xóa.

**Postcondition** — Dữ liệu sự kiện/vé trong hệ thống được cập nhật đúng theo thao tác của Event Supervisor.

---

## UC05 — Review Audit Log (Đối soát và kiểm toán)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F06 (Event Audit Logging) |
| **Precondition** | Đã có dữ liệu lượt quét thô (Bronze) và kết quả đã xử lý (Silver) được ghi nhận |

**Main flow**
1. Event Supervisor chọn vé hoặc khoảng thời gian cần đối soát/điều tra.
2. Hệ thống truy vấn toàn bộ scan event (Bronze) và kết quả xử lý (Silver) liên quan, gồm cả `scan_result`, `ticket_status`, `fraud_alert_code` nếu có.
3. Hệ thống hiển thị danh sách theo trình tự thời gian.
4. Event Supervisor đối chiếu để xác minh sự cố hoặc phục vụ kiểm toán sau sự kiện.

**Exception flow**
- Không tìm thấy dữ liệu cho khoảng thời gian/vé được chọn → hệ thống báo "không có dữ liệu".

**Postcondition** — Event Supervisor có đầy đủ căn cứ để tái hiện sự cố hoặc hoàn tất kiểm toán sau sự kiện.

---

## UC06 — Import Valid Ticket List (Nhập danh sách vé hợp lệ)

| | |
|---|---|
| **Actor** | Ticketing Partner *(tùy chọn, theo 02_Actors.md)* |
| **Precondition** | Ticketing Partner đã hoàn tất phát hành và thanh toán vé cho sự kiện |

**Main flow**
1. Ticketing Partner gửi danh sách vé đã phát hành và thanh toán vào hệ thống, qua tập tin dữ liệu hoặc API nhập liệu, trước thời điểm sự kiện diễn ra.
2. Hệ thống tiếp nhận và khởi tạo `ticket_status = UNUSED` cho từng vé, làm cơ sở đối chiếu cho F02.
3. Hệ thống xác nhận đã nhập thành công.

**Exception flow**
- Dữ liệu gửi lên sai định dạng hoặc thiếu trường bắt buộc → hệ thống từ chối, trả lỗi định dạng.
- Vé trùng ID với vé đã có trong hệ thống → hệ thống từ chối bản ghi trùng.

**Postcondition** — Danh sách vé hợp lệ sẵn sàng trong hệ thống trước khi sự kiện diễn ra.
   b. Đã hết thời gian nhận khách của sự kiện → trả **`EXPIRED`**.
   c. Vé đã `USED` (đã từng quét hợp lệ trước đó) → trả **`USED`**.
   d. Vé còn giới hạn cổng (`ticket_assigned_gate_id`) và `gate_id` hiện tại không khớp → trả **`WRONG_GATE`**.
   e. Không rơi vào trường hợp nào ở trên → trả **`VALID`**.
5. Hệ thống trả kết quả về thiết bị của Gate Operator (F04):
   - `VALID` → cho khách vào, `ticket_status` chuyển từ `VALID` sang `USED`.
   - Mọi kết quả khác → từ chối vào, `ticket_status` không đổi.

**Exception flow**
- Kết quả thuộc nhóm sinh alert (`INVALID`, `USED`, `CANCELLED`, `WRONG_GATE`) → chuyển sang **UC02** để Event Supervisor nhận cảnh báo tương ứng.
- Kết quả `EXPIRED` → từ chối vào nhưng **không** sinh fraud alert .

**Postcondition** — Đúng một trong 6 scan result được ghi nhận cho lượt quét; `ticket_status` chỉ thay đổi khi kết quả là `VALID` (VALID → USED).

---

## UC02 — Receive Fraud Alert (Nhận cảnh báo gian lận)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F03 (Fraud Detection), F05 (Fraud Alerting) |
| **Precondition** | Event Supervisor đã đăng nhập dashboard giám sát trung tâm |

**Main flow**
1. Một lượt quét ở UC01 trả về kết quả thuộc nhóm sinh alert.
2. Hệ thống ánh xạ kết quả sang mã cảnh báo theo đúng bảng của 07:

   | Scan result | Fraud alert code |
   |---|---|
   | `INVALID` | `INVALID_QR` |
   | `USED` | `DUPLICATE_SCAN` |
   | `CANCELLED` | `REVOKED_TICKET` |
   | `WRONG_GATE` | `WRONG_GATE` |

3. Hệ thống bắn cảnh báo lên dashboard gần như ngay lập tức, kèm `ticket_id`, `gate_id`, và với `USED`/`WRONG_GATE` là thông tin đối chiếu lượt quét trước (`previous_scan_gate_id`, `time_since_previous_scan_ms`).
4. Event Supervisor nhận cảnh báo, xem chi tiết.
5. Event Supervisor điều phối xử lý tại hiện trường (ngoài phạm vi hệ thống).

**Exception flow**
- Kết quả là `EXPIRED` hoặc `VALID` → không vào UC02, không sinh alert .


**Postcondition** — Cảnh báo xuất hiện trên dashboard trong vài giây kể từ lượt quét gây ra vi phạm.

---

## UC03 — Monitor Live Dashboard (Giám sát trực tiếp)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F07 (Live Monitoring Dashboard) |
| **Precondition** | Event Supervisor đã đăng nhập; dashboard kết nối được tới dữ liệu đã xử lý |

**Main flow**
1. Event Supervisor mở dashboard giám sát trong lúc sự kiện diễn ra.
2. Dashboard hiển thị theo thời gian thực: tổng lượt quét, phân bố theo từng scan result, tỷ lệ gian lận, danh sách cảnh báo mới nhất.
3. Event Supervisor theo dõi liên tục để nắm tình hình vận hành các cổng.

**Exception flow**
- Mất kết nối giữa dashboard và nguồn dữ liệu → dashboard hiển thị trạng thái "mất kết nối", giữ lại số liệu gần nhất đã tải.

**Postcondition** — Event Supervisor có bức tranh tổng thể, cập nhật liên tục.

---

## UC04 — Manage Ticket & Event Data (Quản lý dữ liệu sự kiện và vé)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F08 (Ticket & Event CRUD) |
| **Precondition** | Event Supervisor đã đăng nhập với quyền quản trị |

**Main flow**
1. Event Supervisor chọn thao tác: tạo mới, cập nhật, tra cứu hoặc xóa dữ liệu sự kiện / loại vé / vé phát hành.
2. Hệ thống hiển thị form hoặc kết quả tương ứng.
3. Event Supervisor xác nhận thao tác.
4. Hệ thống cập nhật dữ liệu, bao gồm cả chuyển `ticket_status` sang `CANCELLED` khi thu hồi vé.

**Exception flow**
- Dữ liệu nhập không hợp lệ (thiếu trường bắt buộc, trùng ID) → hệ thống từ chối lưu, báo lỗi cụ thể.
- Xóa dữ liệu đang được tham chiếu (VD: sự kiện đã có vé phát hành) → hệ thống cảnh báo và yêu cầu xác nhận, hoặc từ chối xóa.

**Postcondition** — Dữ liệu sự kiện/vé trong hệ thống được cập nhật đúng theo thao tác của Event Supervisor.

---

## UC05 — Review Audit Log (Đối soát và kiểm toán)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F06 (Event Audit Logging) |
| **Precondition** | Đã có dữ liệu lượt quét thô (Bronze) và kết quả đã xử lý (Silver) được ghi nhận |

**Main flow**
1. Event Supervisor chọn vé hoặc khoảng thời gian cần đối soát/điều tra.
2. Hệ thống truy vấn toàn bộ scan event (Bronze) và kết quả xử lý (Silver) liên quan, gồm cả `scan_result`, `ticket_status_before`, `fraud_alert_code` nếu có.
3. Hệ thống hiển thị danh sách theo trình tự thời gian.
4. Event Supervisor đối chiếu để xác minh sự cố hoặc phục vụ kiểm toán sau sự kiện.

**Exception flow**
- Không tìm thấy dữ liệu cho khoảng thời gian/vé được chọn → hệ thống báo "không có dữ liệu".

**Postcondition** — Event Supervisor có đầy đủ căn cứ để tái hiện sự cố hoặc hoàn tất kiểm toán sau sự kiện.

---

## UC06 — Import Valid Ticket List (Nhập danh sách vé hợp lệ) 

| | |
|---|---|
| **Actor** | Ticketing Partner *(tùy chọn, theo 02_Actors.md)* |
|
| **Precondition** | Ticketing Partner đã hoàn tất phát hành và thanh toán vé cho sự kiện |

**Main flow**
1. Ticketing Partner gửi danh sách vé đã phát hành và thanh toán vào hệ thống, qua tập tin dữ liệu hoặc API nhập liệu, trước thời điểm sự kiện diễn ra.
2. Hệ thống tiếp nhận và khởi tạo `ticket_status = VALID` cho từng vé, làm cơ sở đối chiếu cho F02.
3. Hệ thống xác nhận đã nhập thành công.

**Exception flow**
- Dữ liệu gửi lên sai định dạng hoặc thiếu trường bắt buộc → hệ thống từ chối, trả lỗi định dạng.
- Vé trùng ID với vé đã có trong hệ thống → hệ thống từ chối bản ghi trùng.

**Postcondition** — Danh sách vé hợp lệ sẵn sàng trong hệ thống trước khi sự kiện diễn ra.




