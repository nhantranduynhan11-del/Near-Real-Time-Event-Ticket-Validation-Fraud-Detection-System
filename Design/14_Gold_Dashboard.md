# 14 — Gold & Dashboard

## 1. Ba bảng Gold

### 1.1 `gold_gate_stats` — thống kê theo cổng (tích lũy, không có chiều thời gian)

Phục vụ `gates[]` ở cả `/dashboard/live` và `/dashboard/stats` — số liệu cộng dồn từ đầu sự kiện,
không cần xem theo mốc thời gian nên không bucket.

| Cột | Kiểu | NULL | Ràng buộc / Ghi chú |
|---|---|---|---|
| event_id | NVARCHAR(20) | Không | PK (phần 1). FK → EVENT.event_id |
| gate_id | NVARCHAR(20) | Không | PK (phần 2). FK → GATE.gate_id |
| total_scans | INT | Không | Mặc định 0 |
| cnt_valid | INT | Không | Mặc định 0. Đếm `scan_result = 'VALID'` |
| cnt_invalid | INT | Không | Mặc định 0 |
| cnt_used | INT | Không | Mặc định 0. Gồm cả `DUPLICATE_SCAN` lẫn `IMPOSSIBLE_TRAVEL` |
| cnt_cancelled | INT | Không | Mặc định 0 |
| cnt_expired | INT | Không | Mặc định 0 |
| cnt_wrong_gate | INT | Không | Mặc định 0 |
| fraud_count | INT | Không | Mặc định 0. Đếm `scan_event.fraud_alert = 1` (cột tính toán sẵn ở 12, chỉ mức FRAUD) |
| warning_count | INT | Không | Mặc định 0. Đếm `alert_level = 'WARNING'` |
| last_scan_at | DATETIME2(3) | Có | `received_at` lớn nhất đã tính vào dòng này |
| updated_at | DATETIME2(3) | Không | Lần Spark cập nhật dòng này gần nhất |

**Khóa chính:** `(event_id, gate_id)`

---

### 1.2 `gold_event_stats` — thống kê theo sự kiện, **có chiều thời gian** (bucket 1 phút)

Mỗi dòng là tổng số liệu của **toàn sự kiện** (mọi cổng cộng lại) trong **đúng 1 phút** theo
`received_at`. Spark luôn ghi bucket rộng 1 phút; muốn 5 hay 10 phút thì API tự `GROUP BY` gộp
bucket lại lúc đọc, Gold không lưu nhiều độ rộng.

| Cột | Kiểu | NULL | Ràng buộc / Ghi chú |
|---|---|---|---|
| event_id | NVARCHAR(20) | Không | PK (phần 1). FK → EVENT.event_id |
| bucket_start | DATETIME2(3) | Không | PK (phần 2). `received_at` làm tròn xuống phút gần nhất, giờ Việt Nam |
| total_scans | INT | Không | Mặc định 0 |
| cnt_valid | INT | Không | Mặc định 0 |
| cnt_invalid | INT | Không | Mặc định 0 |
| cnt_used | INT | Không | Mặc định 0 |
| cnt_cancelled | INT | Không | Mặc định 0 |
| cnt_expired | INT | Không | Mặc định 0 |
| cnt_wrong_gate | INT | Không | Mặc định 0 |
| fraud_count | INT | Không | Mặc định 0 |
| warning_count | INT | Không | Mặc định 0 |
| updated_at | DATETIME2(3) | Không | Lần Spark cập nhật dòng này gần nhất |

**Khóa chính:** `(event_id, bucket_start)`

**Dùng cho `totals`/`scans` (số tích lũy toàn sự kiện, ở cả `live` và `stats`):**
`SUM(cột)` trên mọi dòng của `event_id` đó — index trùng PK nên quét theo khoảng là đủ nhanh cho
polling mỗi giây (một sự kiện vài giờ chỉ có vài trăm dòng).

**Dùng cho `timeline.buckets[]` (chỉ ở `/stats`):**
Đọc trực tiếp các dòng 1 phút, hoặc gộp theo `bucket_minutes = 5/10` bằng cách nhóm
`bucket_start` theo bội số phút tương ứng rồi `SUM`. API tự điền 0 cho các phút trống ở giữa,
vì Gold chỉ ghi dòng khi có ít nhất 1 lượt quét trong phút đó — **không ghi dòng toàn số 0**.

---

### 1.3 `gold_alert` — một dòng mỗi cảnh báo (append-only, không tổng hợp)

Mirror chi tiết của `fraud_alert` + các cột `scan_event` cần hiển thị, để API không phải đọc Silver.
Spark ghi đúng 1 lần ngay khi xử lý xong lượt quét có `alert_level <> 'NONE'`, cùng lúc với
`scan_event`/`fraud_alert` (cùng giao dịch) — không update lại sau đó.

| Cột | Kiểu | NULL | Ràng buộc / Ghi chú |
|---|---|---|---|
| scan_event_id | UNIQUEIDENTIFIER | Không | PK. Giống quan hệ định danh của `fraud_alert` ở 12 |
| event_id | NVARCHAR(20) | Không | FK → EVENT.event_id |
| created_at | DATETIME2(3) | Không | Thời điểm cảnh báo được tạo (copy từ `fraud_alert.created_at`) |
| received_at | DATETIME2(3) | Không | Copy từ `scan_event.received_at` |
| alert_level | NVARCHAR(20) | Không | 'WARNING' hoặc 'FRAUD' |
| alert_code | NVARCHAR(20) | Không | 1 trong 6 mã |
| scan_result | NVARCHAR(20) | Không | Copy từ `scan_event.scan_result` |
| ticket_id | NVARCHAR(20) | Có | NULL khi QR hỏng hoặc vé không khớp DB |
| gate_id | NVARCHAR(20) | Không | |
| scanner_id | NVARCHAR(20) | Không | |
| previous_scan_gate_id | NVARCHAR(20) | Có | Chỉ có giá trị khi `scan_result = 'USED'` |
| time_since_previous_scan_ms | INT | Có | Chỉ có giá trị khi `scan_result = 'USED'` |
| min_travel_time_ms | INT | Có | Chỉ có giá trị khi `USED` ở hai cổng khác nhau và tra được bảng đi bộ |
| ticket_assigned_gate_id | NVARCHAR(20) | Có | Chỉ có giá trị khi `scan_result = 'WRONG_GATE'` |
| distinct_wrong_gate_count | INT | Có | Chỉ có giá trị khi `scan_result = 'WRONG_GATE'` |
| raw_qr_preview | NVARCHAR(24) | Có | 24 ký tự đầu `raw_qr_payload`, chỉ ghi khi `ticket_id IS NULL` |

**Khóa chính:** `scan_event_id`
**Chỉ mục đề xuất:** `(event_id, created_at DESC)` — phục vụ đúng truy vấn `latest_alerts[]`.

**Dùng cho `latest_alerts[]` (live):** `TOP N ... WHERE event_id = @event_id ORDER BY created_at DESC`.
**Dùng cho `alerts_by_code[]` (stats):** `GROUP BY alert_code, alert_level, COUNT(*) WHERE event_id = @event_id` — không cần bảng tổng hợp riêng, gộp trực tiếp từ bảng này.

**Quy tắc điền NULL theo điều kiện** (API áp dụng, không phải Gold): Spark có thể ghi
`ticket_assigned_gate_id` cho mọi vé có gán cổng chứ không riêng `WRONG_GATE`, nên API phải tự che
các trường không áp dụng theo `scan_result`, không tin thẳng giá trị Gold đang có.

---

## 2. Phác thảo Dashboard

### 2.1 Màn hình Live (`/dashboard/live`, polling mỗi 1 giây)

| Vị trí trên màn hình | Con số / nội dung | Lấy từ |
|---|---|---|
| Ô tổng quan | `total_scans`, `by_result.*` (6 giá trị), `fraud_count`, `warning_count` | `SUM(...)` trên `gold_event_stats` theo `event_id` |
| Ô tổng quan | `fraud_rate` | API tính: `fraud_count / total_scans` |
| Bảng theo cổng | `total_scans`, `valid_entries`, `rejected_scans`, `fraud_count`, `warning_count`, `last_scan_at` mỗi cổng | `gold_gate_stats`, 1 dòng mỗi gate_id |
| Danh sách cảnh báo mới nhất | Toàn bộ chi tiết 1 cảnh báo | `gold_alert`, `TOP N ORDER BY created_at DESC` |

### 2.2 Màn hình Stats (`/dashboard/stats`, tải 1 lần + nút làm mới)

| Vị trí trên màn hình | Con số / nội dung | Lấy từ |
|---|---|---|
| `scans.*` | Giống `totals` ở live | `SUM(...)` trên `gold_event_stats` |
| `gates[]` | Giống live, thêm `by_result` theo cổng | `gold_gate_stats` |
| `alerts_by_code[]` | Số cảnh báo theo từng mã, đủ 6 mã | `GROUP BY alert_code` trên `gold_alert` |
| `timeline.buckets[]` | Số liệu theo từng khoảng `bucket_minutes` phút | `gold_event_stats`, gộp bucket theo tham số |
| `attendance.*` | Số vé theo trạng thái, số đã vào | **Không phải Gold** — đọc thẳng `ticket.ticket_status` (ngoại lệ có chủ đích) |

---

## 3. Chu kỳ cập nhật Gold (Spark ghi)

Cả 3 bảng được Spark `MERGE`/`INSERT` ngay sau mỗi micro-batch xử lý xong:

- `gold_gate_stats`: `MERGE` cộng dồn vào dòng `(event_id, gate_id)` đã có.
- `gold_event_stats`: `MERGE` cộng dồn vào dòng `(event_id, bucket_start)` của phút tương ứng;
  phút mới thì `INSERT` dòng mới.
- `gold_alert`: `INSERT` thêm 1 dòng mỗi lượt quét có `alert_level <> 'NONE'` trong batch, không update.
