# Task 1.4 - Scan Event Specification

## Input Scan Event (Bronze) - Dữ liệu thô do scanner đọc

Sinh ra mỗi khi scanner ở một cổng đọc được QR và gửi request lên API.

| Field | Data Type | Required | Description | Source |
|---|---|---|---|---|
| `event_id` | string (UUID v4) | Bắt buộc | ID duy nhất cho một lần gọi API. Duy nhất toàn hệ thống | API (sinh lúc nhận request) |
| `raw_qr_payload` | string | Bắt buộc | Chuỗi thô đọc trực tiếp từ QR, trước khi giải mã thành `ticket_id`. Không được rỗng | Scanner |
| `ticket_id` | string | Bắt buộc khi decode_error = false, null khi = true | Mã vé, giải mã từ `raw_qr_payload`. Nếu giải mã fail thì để trống, cờ `decode_error = true` | Scanner (giải mã tại chỗ) |
| `decode_error` | boolean | Bắt buộc | QR có giải mã được thành `ticket_id` hợp lệ không (true/false) | Scanner |
| `gate_id` | string | Bắt buộc | Cổng thực hiện quét. Nằm trong tập cổng đã đăng ký (GATE_A...GATE_D) | Config thiết bị |
| `scanner_id` | string | Bắt buộc | Thiết bị quét nào thực hiện. Duy nhất theo thiết bị | Config thiết bị |
| `operator_id` | string | Tùy chọn | Nhân viên đang đăng nhập vận hành scanner. Rỗng nếu không yêu cầu login | App (session) |
| `scanned_at` | timestamp (UTC) | Bắt buộc | Lúc scanner ghi nhận việc quét. Theo đồng hồ máy quét, có thể lệch với server | Scanner (client clock) |
| `received_at` | timestamp (UTC) | Bắt buộc | Lúc API nhận được request | API (server clock) |

## Processed Scan Event (Silver) - Dữ liệu sau khi được xử lý

Kế thừa toàn bộ 9 field ở trên, cộng thêm:

| Field | Data Type | Required | Description | Source |
|---|---|---|---|---|
| `processing_ts` | timestamp (UTC) | Bắt buộc | Lúc Spark xử lý xong event. Phải ≥ `received_at` | Processing (Spark) |
| `ticket_status_before` | enum (`VALID`/`USED`/`CANCELLED`) | Bắt buộc | Trạng thái vé ngay trước khi xử lý scan này. Là trạng thái sống của vé (khác `scan_result`), chỉ có 3 giá trị | Processing (tra ticket state store) |
| `scan_result` | enum | Bắt buộc | Kết quả xác thực lần scan. 1 trong 6 giá trị ở Task 1.3 (`VALID`/`INVALID`/`USED`/`CANCELLED`/`EXPIRED`/`WRONG_GATE`) | Processing |
| `is_duplicate` | boolean | Bắt buộc | Có trùng với vé đã `USED` không. true chỉ khi `scan_result = USED` | Processing (dedup) |
| `previous_scan_event_id` | string (UUID) | Điều kiện | `event_id` của lần quét hợp lệ trước đó. Bắt buộc nếu `is_duplicate = true` | Processing |
| `previous_scan_gate_id` | string | Điều kiện | Cổng của lần quét hợp lệ trước đó. Bắt buộc nếu `is_duplicate = true` | Processing |
| `time_since_previous_scan_ms` | integer (ms) | Điều kiện | Khoảng cách thời gian với lần quét hợp lệ trước, tính theo `scanned_at`. ≥ 0, bắt buộc nếu `is_duplicate = true` | Processing |
| `ticket_assigned_gate_id` | string (hoặc null nếu vé không giới hạn cổng) | Điều kiện | Cổng được phép vào của vé (nếu vé có giới hạn cổng), dùng để đối chiếu với `gate_id` ở Bronze | Processing (tra ticket master data) |
| `is_wrong_gate` | boolean | Bắt buộc | Vé bị quét sai cổng so với `ticket_assigned_gate_id` không. true chỉ khi `scan_result = WRONG_GATE` | Processing |
| `fraud_alert` | boolean | Bắt buộc | Có sinh cảnh báo gian lận không. true khi `scan_result` thuộc nhóm sinh alert (`INVALID`/`USED`/`CANCELLED`/`WRONG_GATE`) | Processing |
| `fraud_alert_code` | enum (`INVALID_QR`/`DUPLICATE_SCAN`/`REVOKED_TICKET`/`WRONG_GATE`) hoặc null | Điều kiện | Mã cảnh báo cụ thể, lấy theo bảng mapping `scan_result` → mã alert ở Task 1.3. Bắt buộc khi `fraud_alert = true`, null khi `fraud_alert = false` | Processing |
| `ingestion_lag_ms` | integer (ms) | Tùy chọn | Độ trễ giữa `received_at` và `processing_ts`, để theo dõi pipeline chứ không phải dữ liệu nghiệp vụ. ≥ 0 | Processing |

`Chú thích`: ở `ticket_status_before` chỉ có 3 giá trị là vì đây là trạng thái của vé, không phải trạng thái của một lần scan (1.3) 
## Field nào từ đâu ra

- Scanner gửi lên: `raw_qr_payload`, `ticket_id`, `decode_error`, `gate_id`, `scanner_id`, `scanned_at`
- API bổ sung: `event_id`, `received_at`
- Processing bổ sung: `processing_ts`, `ticket_status_before`, `scan_result`, `is_duplicate`, `previous_scan_event_id`, `previous_scan_gate_id`, `time_since_previous_scan_ms`, `ticket_assigned_gate_id`, `is_wrong_gate`, `fraud_alert`, `fraud_alert_code`, `ingestion_lag_ms`