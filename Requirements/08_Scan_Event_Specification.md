# Task 1.4 - Scan Event Specification

## Input Scan Event (Bronze) - Dữ liệu thô do scanner đọc

Sinh ra mỗi khi scanner ở một cổng đọc được QR và gửi request lên API.

| Field | Data Type | Required | Description | Source |
|---|---|---|---|---|
| `event_id` | string (UUID v4) | Bắt buộc | ID duy nhất cho một lần gọi API. Duy nhất toàn hệ thống | API (sinh lúc nhận request) |
| `raw_qr_payload` | string | Bắt buộc | Chuỗi thô đọc trực tiếp từ QR, trước khi giải mã thành `ticket_id`. Không được rỗng | Scanner (thiết bị) |
| `ticket_id` | string | Bắt buộc khi `decode_error = false`, null khi `= true` | Mã vé, giải mã từ `raw_qr_payload`. Nếu giải mã fail thì để trống, cờ `decode_error = true` | Scanner (giải mã tại chỗ) |
| `decode_error` | boolean | Bắt buộc | QR có giải mã được thành `ticket_id` hợp lệ không (true/false) | Scanner (thiết bị) |
| `gate_id` | string | Bắt buộc | Cổng thực hiện quét. Nằm trong tập cổng đã đăng ký (GATE_A...GATE_D) | Config thiết bị |
| `scanner_id` | string | Bắt buộc | Thiết bị quét nào thực hiện. Duy nhất theo thiết bị (khác `operator_id` — đây là mã máy, không phải mã người) | Config thiết bị |
| `operator_id` | string | Tùy chọn | Gate Operator nào đang đăng nhập vận hành scanner. Rỗng nếu không yêu cầu login | App (session) |
| `scanned_at` | timestamp (UTC) | Bắt buộc | Lúc scanner ghi nhận việc quét. Theo đồng hồ máy quét, có thể lệch với server — chỉ dùng để hiển thị, không dùng cho bất kỳ phép so sánh thời gian nào | Scanner (client clock) |
| `received_at` | timestamp (UTC) | Bắt buộc | Lúc API nhận được request. **Mốc chuẩn cho mọi tính toán liên quan tới thời gian**: so giờ nhận khách, tính khoảng cách giữa hai lần quét, sắp xếp thứ tự sự kiện | API (server clock) |

## Processed Scan Event (Silver) - Dữ liệu sau khi được xử lý

Kế thừa toàn bộ 9 field ở trên, cộng thêm:

| Field | Data Type | Required | Description | Source |
|---|---|---|---|---|
| `processing_ts` | timestamp (UTC) | Bắt buộc | Lúc Spark xử lý xong event. Phải ≥ `received_at` | Processing (Spark) |
| `ticket_status_before` | enum (`UNUSED`/`VALID_ENTRY`/`FLAGGED_FRAUD`/`EXPIRED`/`CANCELLED`) | Bắt buộc khi `decode_error = false` và vé tồn tại; null khi không tra được vé | Trạng thái vé ngay trước khi xử lý scan này, đọc từ cột `ticket_status`. Đủ 5 trạng thái của `06_Ticket_Lifecycle.md` — `EXPIRED` là trạng thái lưu thật, không phải giá trị tính tạm | Processing (tra ticket state store) |
| `ticket_status_after` | enum (cùng tập với `ticket_status_before`) | Bắt buộc khi `ticket_status_before` khác null | Trạng thái vé sau khi xử lý scan này. Chỉ khác `ticket_status_before` khi `scan_result = VALID` (`UNUSED`→`VALID_ENTRY`) hoặc `scan_result = USED` trên vé đang `VALID_ENTRY` (→`FLAGGED_FRAUD`) | Processing |
| `scan_result` | enum (`VALID`/`INVALID`/`USED`/`CANCELLED`/`EXPIRED`/`WRONG_GATE`) | Bắt buộc | Kết quả xác thực lần scan, tính theo thứ tự ưu tiên tại `07_Scan_Results.md` | Processing |
| `is_duplicate` | boolean | Bắt buộc | Có trùng với vé đã có entry hợp lệ không. true chỉ khi `scan_result = USED` | Processing (dedup) |
| `previous_scan_event_id` | string (UUID) | Điều kiện | `event_id` của lần quét hợp lệ trước đó. Bắt buộc nếu `is_duplicate = true` | Processing |
| `previous_scan_gate_id` | string | Điều kiện | Cổng của lần quét hợp lệ trước đó. Bắt buộc nếu `is_duplicate = true` | Processing |
| `time_since_previous_scan_ms` | integer (ms) | Điều kiện | Khoảng cách thời gian với lần quét hợp lệ trước, tính theo **`received_at`** (server clock), không dùng `scanned_at`. ≥ 0, bắt buộc nếu `is_duplicate = true` | Processing |
| `ticket_assigned_gate_id` | string hoặc null | Điều kiện | Cổng được phép vào của vé (null nếu vé không giới hạn cổng), dùng để đối chiếu với `gate_id` ở Bronze | Processing (tra ticket master data) |
| `is_wrong_gate` | boolean | Bắt buộc | Vé bị quét sai cổng so với `ticket_assigned_gate_id` không. true khi `scan_result = WRONG_GATE`, bất kể sau đó alert ở mức WARNING hay FRAUD | Processing |
| `distinct_wrong_gate_count` | integer | Điều kiện | Số cổng **khác nhau** mà vé này từng bị `WRONG_GATE`, tính lũy kế tới lần quét hiện tại (quét sai lặp lại cùng 1 cổng không cộng thêm). Tối đa bằng `N − 1` với `N` là tổng số cổng, vì quét đúng cổng không sinh `WRONG_GATE`. Bắt buộc khi `scan_result = WRONG_GATE` | Processing |
| `alert_level` | enum (`NONE`/`WARNING`/`FRAUD`) | Bắt buộc | Mức cảnh báo của lần scan này, theo bảng ánh xạ ở `07_Scan_Results.md`. `INVALID`/`USED`/`CANCELLED` luôn `FRAUD`; `VALID`/`EXPIRED` luôn `NONE`; `WRONG_GATE` là `WARNING` hoặc `FRAUD` tuỳ `distinct_wrong_gate_count` | Processing |
| `alert_code` | enum (`INVALID_QR`/`DUPLICATE_SCAN`/`REVOKED_TICKET`/`WRONG_GATE_WARNING`/`WRONG_GATE_FRAUD`) hoặc null | Điều kiện | Mã cảnh báo cụ thể. Bắt buộc khi `alert_level ≠ NONE`, null khi `alert_level = NONE` | Processing |
| `fraud_alert` | boolean | Bắt buộc | Tiện ích cho dashboard: `true` khi `alert_level = FRAUD`, `false` khi `NONE` hoặc `WARNING`. Chỉ để lọc nhanh tỉ lệ gian lận thật (loại `WARNING` ra khỏi con số này) | Processing (derived từ `alert_level`) |
| `ingestion_lag_ms` | integer (ms) | Tùy chọn | Độ trễ giữa `received_at` và `processing_ts`, để theo dõi pipeline chứ không phải dữ liệu nghiệp vụ. ≥ 0 | Processing |

### Vì sao `ticket_status_before` có đủ 5 giá trị

`06_Ticket_Lifecycle.md` chốt cả năm trạng thái đều được lưu ở cột `ticket_status`, gồm cả `EXPIRED`.
Một tiến trình định kỳ chuyển vé còn `UNUSED` sang `EXPIRED` khi hết giờ nhận khách, nên một lượt
quét đến sau thời điểm đó hoàn toàn có thể đọc được `ticket_status_before = EXPIRED`.

Ngược lại, một lượt quét rơi vào khoảng giữa lúc đóng cổng và lúc tiến trình chạy sẽ đọc được
`ticket_status_before = UNUSED` nhưng vẫn cho `scan_result = EXPIRED`, vì bước 4 của precedence còn
so `received_at` với giờ nhận khách. Hai field này vì vậy **không phải lúc nào cũng khớp nhau**.

## Field nào từ đâu ra

- **Scanner (thiết bị)** gửi lên: `raw_qr_payload`, `ticket_id`, `decode_error`, `gate_id`,
  `scanner_id`, `scanned_at`
- **App/session** (Gate Operator đăng nhập) bổ sung: `operator_id`
- **API** bổ sung: `event_id`, `received_at`
- **Processing** bổ sung: `processing_ts`, `ticket_status_before`, `ticket_status_after`,
  `scan_result`, `is_duplicate`, `previous_scan_event_id`, `previous_scan_gate_id`,
  `time_since_previous_scan_ms`, `ticket_assigned_gate_id`, `is_wrong_gate`,
  `distinct_wrong_gate_count`, `alert_level`, `alert_code`, `fraud_alert`, `ingestion_lag_ms`

Nguyên tắc: client chỉ gửi thứ nó thực sự quan sát được. Mọi kết luận nghiệp vụ — kết quả xác thực,
mức cảnh báo, trạng thái vé — đều do phía server và pipeline quyết định, không nhận từ client.
