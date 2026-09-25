# 05 — Use Cases (Phase 1 · 1.1)

Actor theo đúng `02_Actors.md`: **Gate Operator**, **Event Supervisor**, **Ticketing Partner**.
Theo quy ước tại mục 3 của 02, "System" không được biểu diễn như Actor — mọi xử lý ngầm xuất hiện
trong main flow như hành động của hệ thống.

Tập kết quả scan và thứ tự ưu tiên xử lý nằm ở `07_Scan_Results.md`; tài liệu này tham chiếu tới đó
chứ không viết lại.

---

## UC01 — Scan Ticket at Gate (Quét vé tại cổng)

| | |
|---|---|
| **Actor** | Gate Operator |
| **Function liên quan** | F01 (Scan Ingestion), F02 (Ticket Validation), F04 (Entry Feedback) |
| **Precondition** | Gate Operator đã được gán vào một gate cụ thể (Gate A/B/C/D); thiết bị quét kết nối ổn định tới hệ thống |

**Main flow**

1. Gate Operator quét mã QR trên vé của khách tại gate được phân công.
2. Hệ thống tiếp nhận lượt soát vé: `raw_qr_payload`, `gate_id`, `scanner_id`, `scanned_at` (F01);
   API bổ sung `event_id` và `received_at`.
3. Hệ thống giải mã QR thành `ticket_id`.
4. Hệ thống tra `ticket_status` hiện tại và xác định `scan_result` bằng cách áp dụng
   **thứ tự ưu tiên định nghĩa tại `07_Scan_Results.md`**, dừng ở bước đầu tiên khớp điều kiện.
   Kết quả thuộc đúng một trong sáu giá trị: `VALID`, `INVALID`, `USED`, `CANCELLED`, `EXPIRED`,
   `WRONG_GATE`.
5. Hệ thống trả kết quả về thiết bị của Gate Operator (F04):
   - `VALID` → cho khách vào; `ticket_status` chuyển `UNUSED` → `VALID_ENTRY`.
   - Mọi kết quả khác → từ chối cho vào.
6. Nếu kết quả có `alert_level ≠ NONE`, hệ thống chuyển sang **UC02** để sinh cảnh báo.

**Exception flow**

- **`USED`** — vé đang ở `VALID_ENTRY` hoặc `FLAGGED_FRAUD` bị quét lại.
  Từ `VALID_ENTRY`, `ticket_status` chuyển sang `FLAGGED_FRAUD`.
  Từ `FLAGGED_FRAUD`, `ticket_status` giữ nguyên `FLAGGED_FRAUD` (self-transition, xem 06).
  Cả hai trường hợp đều sinh cảnh báo `DUPLICATE_SCAN` qua UC02.
- **`INVALID`** — QR không giải mã được (`decode_error = true`), `ticket_id` không tồn tại trong DB,
  hoặc vé tồn tại nhưng thuộc sự kiện khác. `ticket_status` không đổi. Sinh cảnh báo `INVALID_QR`
  qua UC02.
- **`CANCELLED`** — vé đã bị thu hồi. `ticket_status` giữ nguyên `CANCELLED`.
  Sinh cảnh báo `REVOKED_TICKET` qua UC02.
- **`WRONG_GATE`** — vé còn `UNUSED`, còn trong giờ nhận khách, nhưng `gate_id` không khớp
  `ticket_assigned_gate_id`. `ticket_status` giữ nguyên `UNUSED`. Sinh cảnh báo qua UC02 ở mức
  WARNING hoặc FRAUD tuỳ `distinct_wrong_gate_count` (xem 07).
- **`EXPIRED`** — vé đã ở `EXPIRED`, hoặc còn `UNUSED` nhưng `received_at` nằm ngoài giờ nhận khách.
  `ticket_status` giữ nguyên. **Không** sinh cảnh báo, không vào UC02.
- **Mất kết nối giữa thiết bị quét và hệ thống** — thiết bị hiển thị trạng thái không kết nối được,
  không tự quyết định cho vào hay từ chối. Cơ chế lưu đệm ngoại tuyến nằm ngoài phạm vi MVP
  (xem `04_MVP.md`).

**Postcondition**

Đúng một `scan_result` được ghi nhận cho lượt quét, cùng `alert_level` và `alert_code` tương ứng.

`ticket_status` chỉ đổi trong hai trường hợp:

| Kết quả | Chuyển trạng thái |
|---|---|
| `VALID` | `UNUSED` → `VALID_ENTRY` |
| `USED` trên vé đang `VALID_ENTRY` | `VALID_ENTRY` → `FLAGGED_FRAUD` |

Mọi kết quả còn lại — gồm cả `USED` trên vé đã ở `FLAGGED_FRAUD` — đều giữ nguyên `ticket_status`.

---

## UC02 — Receive Fraud Alert (Nhận cảnh báo gian lận)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F03 (Fraud Detection), F05 (Fraud Alerting) |
| **Precondition** | Event Supervisor đã đăng nhập dashboard giám sát trung tâm |

**Main flow**

1. Một lượt quét ở UC01 cho ra `scan_result` thuộc nhóm sinh cảnh báo.
2. Hệ thống xác định `alert_level` và `alert_code` theo bảng của `07_Scan_Results.md`:

   | Scan result | Alert level | Alert code |
   |---|---|---|
   | `INVALID` | FRAUD | `INVALID_QR` |
   | `USED`, hai cổng khác nhau và nhanh hơn thời gian đi bộ tối thiểu | FRAUD | `IMPOSSIBLE_TRAVEL` |
   | `USED`, các trường hợp còn lại | FRAUD | `DUPLICATE_SCAN` |
   | `CANCELLED` | FRAUD | `REVOKED_TICKET` |
   | `WRONG_GATE`, `distinct_wrong_gate_count < N − 1` | WARNING | `WRONG_GATE_WARNING` |
   | `WRONG_GATE`, `distinct_wrong_gate_count = N − 1` | FRAUD | `WRONG_GATE_FRAUD` |
   | `VALID`, `EXPIRED` | NONE | không sinh cảnh báo |

   `N` là tổng số cổng của sự kiện. Điều kiện phân biệt `IMPOSSIBLE_TRAVEL` với `DUPLICATE_SCAN`
   nằm ở quy tắc R4 trong `09_Fraud_Rules.md`.

3. Hệ thống bắn cảnh báo lên dashboard gần như ngay lập tức, kèm `ticket_id`, `gate_id`,
   `alert_level`, `alert_code`; với `USED` kèm thêm thông tin đối chiếu lượt quét trước
   (`previous_scan_gate_id`, `time_since_previous_scan_ms`); với `WRONG_GATE` kèm
   `ticket_assigned_gate_id` và `distinct_wrong_gate_count`.
4. Event Supervisor nhận cảnh báo, xem chi tiết.
5. Event Supervisor điều phối xử lý tại hiện trường (ngoài phạm vi hệ thống).

**Quy ước tính fraud rate**

Chỉ các cảnh báo có `alert_level = FRAUD` được tính vào tỷ lệ gian lận hiển thị trên dashboard.
Mức `WARNING` được hiển thị trong danh sách cảnh báo nhưng **không** tính vào con số đó, để khách
đi lạc cổng không làm nhiễu chỉ số gian lận.

Field `fraud_alert` trong `08_Scan_Event_Specification.md` là biến boolean suy ra từ `alert_level`,
dùng để lọc nhanh đúng nhóm này.

**Exception flow**

- `scan_result` là `VALID` hoặc `EXPIRED` → `alert_level = NONE`, không vào UC02.
- Cảnh báo `WRONG_GATE_FRAUD` **không** làm đổi `ticket_status`; vé vẫn `UNUSED` và vẫn vào được
  đúng cổng của nó. Đây là quyết định có chủ đích, lý do ở cuối `07_Scan_Results.md`.

**Postcondition**

Cảnh báo xuất hiện trên dashboard trong vài giây kể từ lượt quét gây ra vi phạm, với đúng
`alert_level` và `alert_code` theo bảng trên.

---

## UC03 — Monitor Live Dashboard (Giám sát trực tiếp)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F07 (Live Monitoring Dashboard) |
| **Precondition** | Event Supervisor đã đăng nhập; dashboard kết nối được tới dữ liệu đã xử lý |

**Main flow**

1. Event Supervisor mở dashboard giám sát trong lúc sự kiện diễn ra.
2. Dashboard hiển thị theo thời gian thực: tổng lượt quét, phân bố theo từng `scan_result`, tỷ lệ
   gian lận (chỉ tính `alert_level = FRAUD`), danh sách cảnh báo mới nhất.
3. Event Supervisor theo dõi liên tục để nắm tình hình vận hành các cổng.

**Exception flow**

- Mất kết nối giữa dashboard và nguồn dữ liệu → dashboard hiển thị trạng thái "mất kết nối",
  giữ lại số liệu gần nhất đã tải.

**Postcondition** — Event Supervisor có bức tranh tổng thể, cập nhật liên tục.

---

## UC04 — Manage Ticket & Event Data (Quản lý dữ liệu sự kiện và vé)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F08 (Ticket & Event CRUD) |
| **Precondition** | Event Supervisor đã đăng nhập với quyền quản trị |

**Main flow**

1. Event Supervisor chọn thao tác: tạo mới, cập nhật, tra cứu hoặc xóa dữ liệu sự kiện / loại vé /
   vé phát hành.
2. Hệ thống hiển thị form hoặc kết quả tương ứng.
3. Event Supervisor xác nhận thao tác.
4. Hệ thống cập nhật dữ liệu, bao gồm cả chuyển `ticket_status` sang `CANCELLED` khi thu hồi vé.

**Exception flow**

- Dữ liệu nhập không hợp lệ (thiếu trường bắt buộc, trùng ID) → hệ thống từ chối lưu, báo lỗi cụ thể.
- Xóa dữ liệu đang được tham chiếu (VD: sự kiện đã có vé phát hành) → hệ thống cảnh báo và yêu cầu
  xác nhận, hoặc từ chối xóa.
- Thu hồi vé đang ở `VALID_ENTRY` hoặc `FLAGGED_FRAUD` → hệ thống từ chối, vì 06 chỉ cho phép
  transition `UNUSED → CANCELLED`.

**Postcondition** — Dữ liệu sự kiện/vé được cập nhật đúng theo thao tác của Event Supervisor.

---

## UC05 — Review Audit Log (Đối soát và kiểm toán)

| | |
|---|---|
| **Actor** | Event Supervisor |
| **Function liên quan** | F06 (Event Audit Logging) |
| **Precondition** | Đã có dữ liệu lượt quét thô (Bronze) và kết quả đã xử lý (Silver) được ghi nhận |

**Main flow**

1. Event Supervisor chọn vé hoặc khoảng thời gian cần đối soát/điều tra.
2. Hệ thống truy vấn toàn bộ scan event (Bronze) và kết quả xử lý (Silver) liên quan, gồm
   `scan_result`, `ticket_status_before`, `alert_level` và `alert_code` nếu có.
3. Hệ thống hiển thị danh sách theo trình tự thời gian, sắp theo `received_at`.
4. Event Supervisor đối chiếu để xác minh sự cố hoặc phục vụ kiểm toán sau sự kiện.

**Exception flow**

- Không tìm thấy dữ liệu cho khoảng thời gian/vé được chọn → hệ thống báo "không có dữ liệu".

**Postcondition** — Event Supervisor có đầy đủ căn cứ để tái hiện sự cố hoặc hoàn tất kiểm toán.

---

## UC06 — Import Valid Ticket List (Nhập danh sách vé hợp lệ)

| | |
|---|---|
| **Actor** | Ticketing Partner *(hệ thống ngoại vi)*, Event Supervisor *(nhập thủ công)* |
| **Function liên quan** | F09 (Import Valid Ticket List) |
| **Precondition** | Đã hoàn tất phát hành và thanh toán vé cho sự kiện |

**Main flow**

1. Ticketing Partner gửi danh sách vé đã phát hành vào hệ thống qua tập tin dữ liệu (CSV/JSON) hoặc
   API nhập liệu, trước thời điểm sự kiện diễn ra. Event Supervisor cũng có thể tự nạp tập tin này
   qua giao diện quản trị.
2. Hệ thống tiếp nhận và khởi tạo `ticket_status = UNUSED` cho từng vé, làm cơ sở đối chiếu cho F02.
3. Hệ thống xác nhận đã nhập thành công, kèm số bản ghi nhận và số bản ghi bị từ chối.

**Exception flow**

- Dữ liệu sai định dạng hoặc thiếu trường bắt buộc → hệ thống từ chối, trả lỗi định dạng.
- Vé trùng `ticket_id` với vé đã có trong hệ thống → hệ thống từ chối bản ghi trùng, giữ nguyên
  bản ghi cũ, và liệt kê danh sách bị từ chối.

**Postcondition** — Danh sách vé hợp lệ sẵn sàng trong hệ thống trước khi sự kiện diễn ra, mọi vé ở
trạng thái `UNUSED`.

---

## Đối chiếu với Function List (03)

| Use Case | Function bao phủ |
|---|---|
| UC01 — Scan Ticket at Gate | F01, F02, F04 |
| UC02 — Receive Fraud Alert | F03, F05 |
| UC03 — Monitor Live Dashboard | F07 |
| UC04 — Manage Ticket & Event Data | F08 |
| UC05 — Review Audit Log | F06 |
| UC06 — Import Valid Ticket List | F09 |

Đủ F01–F09, không function nào bị bỏ sót và không phát sinh function mới ngoài `03_Functions.md`.
