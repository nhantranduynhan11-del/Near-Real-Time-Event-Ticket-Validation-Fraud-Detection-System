# 15 — API Contract
phần 0 - 6 là nội dung chính 
phần 7 là mấy phần tui muốn thêm, nhưng có file 14 thì tui mới chốt được nên ông để đó tui bổ sung thêm nhé
## 0. Quy ước chung

| Nội dung | Quy ước |
|---|---|
| Tiền tố | Mọi endpoint nằm dưới `/api`. Dùng **số nhiều** cho tập hợp: `/api/tickets/:id`. Chuyển từ `GET /ticket/:id` thành `GET /api/tickets/:id` để đảm bảo quy tắc này |
| Định dạng | JSON, `Content-Type: application/json; charset=utf-8`. Ngoại lệ: `POST /api/tickets/import` nhận thêm `multipart/form-data` |
| Xác thực | `Authorization: Bearer <access_token>` lấy từ `POST /api/login`. Token JWT, claim `sub` = `user_id`, `role` = vai trò. Thời hạn 12 giờ, MVP không có refresh token |
| Phân quyền | `GATE_OPERATOR`: `POST /scan`, `GET /scan/:id`, `GET /tickets/:id`. `EVENT_SUPERVISOR`: mọi endpoint còn lại. Phân quyền chi tiết hơn nằm ngoài MVP (file 04) |
| Mã định danh | `event_id`, `gate_id`, `scanner_id`, `ticket_id`, `user_id` khớp `^[A-Z0-9_]{1,20}$`. Lý do: collation `Vietnamese_CI_AS` coi `ev001` và `EV001` là một. Chữ thường bị từ chối bằng `400`, không tự đổi sang chữ hoa. **Ngoại lệ:** `ticket_id` trong `POST /scan` không bị kiểm tra định dạng này (xem 2.1) |
| Giá trị liệt kê | Luôn chữ hoa: `scan_result`, `alert_level`, `alert_code`, `ticket_status`, `role` |
| Mã lượt quét | `scan_event_id`: UUID v4 chữ thường, 36 ký tự, do **API** sinh |
| Thời gian | Chuỗi ISO 8601 **kèm offset `+07:00`**, chính xác tới mili giây: `2026-12-12T19:00:01.000+07:00`. API nhận mọi offset hợp lệ, đổi về giờ Việt Nam trước khi ghi `DATETIME2(3)`, và luôn trả `+07:00`. Chuỗi thiếu offset (ví dụ `2026-12-12T19:00:01`) bị từ chối bằng `400`, vì không biết là giờ nào. |
| Khoảng thời gian | Số nguyên mili giây, tên trường kết thúc `_ms` |
| Tỷ lệ | Số thực từ 0 đến 1, làm tròn 4 chữ số (`0.0174` là 1,74%). Giao diện tự nhân 100 |
| Biến môi trường của API | Lấy từ `.env` ở file 11 mục 8: `ACTIVE_EVENT_ID`, `TZ=Asia/Ho_Chi_Minh`, `API_PORT`, `DB_*`, `KAFKA_*`. API cần thêm 3 biến **chưa có** trong `.env.example`: `JWT_SECRET`, `JWT_EXPIRES_IN` (12 giờ), `SCAN_WAIT_MS` (3000) |
| Phục vụ giao diện | API Express ở cổng 3000 phục vụ luôn trang dashboard dưới dạng tệp tĩnh (file 11, mục 1 và 6). Cùng một origin với `/api` nên không cần CORS. Mọi đường dẫn ngoài `/api` là tệp tĩnh, không thuộc tài liệu này. Thư viện biểu đồ nằm trong repo, không tải từ mạng |
| Truy vấn SQL Server | Gắn mọi tham số chuỗi bằng kiểu `NVarChar` (file 11, mục 4). Gắn `VarChar` thì so sánh với cột `NVARCHAR` bị chuyển kiểu ngầm và chỉ mục không được dùng |
| Phân trang | Query `page` (mặc định 1), `page_size` (mặc định 50, tối đa 200). Trả `{ "items": [...], "page": 1, "page_size": 50, "total": 123 }` |

### Dạng lỗi chung

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dữ liệu gửi lên không hợp lệ.",
    "details": [ { "field": "gate_id", "issue": "Bắt buộc" } ]
  }
}
```

`details` có thể vắng. `code` là chuỗi ổn định để giao diện xử lý; `message` chỉ để người đọc.

### Mã HTTP dùng chung

| HTTP | Khi nào | `error.code` thường gặp |
|---|---|---|
| 400 | Sai hình dạng dữ liệu: thiếu trường, sai kiểu, sai định dạng, ID chữ thường | `VALIDATION_ERROR` |
| 401 | Thiếu hoặc sai token | `UNAUTHENTICATED`, `TOKEN_EXPIRED` |
| 403 | Có token nhưng sai vai trò | `FORBIDDEN` |
| 404 | Không có đối tượng được gọi theo đường dẫn | `<ĐỐI_TƯỢNG>_NOT_FOUND` |
| 409 | Xung đột trạng thái hoặc khóa: trùng ID, đang được tham chiếu, chuyển trạng thái không được phép | `<ĐỐI_TƯỢNG>_ALREADY_EXISTS`, `<ĐỐI_TƯỢNG>_IN_USE`, `INVALID_STATE_TRANSITION` |
| 413 | Tệp nhập quá lớn | `PAYLOAD_TOO_LARGE` |
| 422 | Dữ liệu đúng hình dạng nhưng vi phạm quy tắc nghiệp vụ | xem từng endpoint |
| 500 | Lỗi không lường trước | `INTERNAL_ERROR` |
| 503 | Hàng đợi (Kafka) hoặc cơ sở dữ liệu không dùng được | `SERVICE_UNAVAILABLE`, `DASHBOARD_DATA_UNAVAILABLE` |

---

## 1. Dashboard

Hai endpoint cho UC03 / F07. Cả hai chỉ cho `EVENT_SUPERVISOR`, chỉ đọc.

Trong file 11 quy định cho phần này:

- **Dashboard không đọc Silver** (điều cấm 2, mục 3). Mọi số liệu và danh sách cảnh báo lấy từ **Gold**, tức các bảng thống kê trong SQL Server do Spark ghi. Hai bảng `scan_event` và `fraud_alert` không được đọc ở đây.
- **`live` làm mới mỗi giây; `stats` tải một lần và có nút làm mới** (mục 6).
- `stats` gồm "tổng hợp theo cổng và theo thời gian" (mục 6), nên Gold phải có **chiều thời gian** (xem 1.3).

Quy tắc chung cho cả hai:

- **Tỷ lệ gian lận** = `fraud_count / total_scans`, trong đó `fraud_count` là số lượt quét có `alert_level = 'FRAUD'`. Mức `WARNING` **không** được tính vào tử số, nhưng vẫn nằm trong danh sách cảnh báo và có bộ đếm riêng `warning_count`. Mẫu số là **mọi** lượt quét, kể cả `VALID`. Khi `total_scans = 0` thì `fraud_rate = 0`.
- Mỗi lượt quét sinh tối đa một cảnh báo (file 09, file 12), nên `fraud_count` vừa là số lượt quét gian lận vừa là số cảnh báo `FRAUD`.
- Mỗi khối số liệu lấy từ Gold kèm `updated_at` (lần cập nhật Gold gần nhất của khối đó) để giao diện cho biết số liệu cũ bao nhiêu.
- Query `event_id` tùy chọn, mặc định là `ACTIVE_EVENT_ID`. Sự kiện không tồn tại → `404 EVENT_NOT_FOUND`.
- Danh sách cổng luôn **đủ mọi cổng** của sự kiện (lấy từ `event_gate`); cổng chưa có lượt quét trả toàn số 0.
- **Gold chưa có dòng nào** (chưa có lượt quét, hoặc đang chạy chế độ `app` của file 11 mục 7 nên không có Spark) → trả toàn số 0 và danh sách rỗng, **không** trả lỗi. Chỉ khi không nối được SQL Server mới trả `503`.
- Phản hồi kèm `Cache-Control: no-store`, vì trình duyệt hỏi theo chu kì và không được dùng bản lưu cũ.

### 1.1 `GET /api/dashboard/live`

Dữ liệu cho các ô cập nhật liên tục. Trình duyệt gọi lại sau **mỗi 1 giây** (polling), nên phản hồi phải nhẹ và truy vấn chỉ đọc bảng Gold nhỏ có chỉ mục.

**Query**

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `event_id` | string | Không | Mặc định `ACTIVE_EVENT_ID` |
| `alerts_limit` | integer | Không | Số cảnh báo mới nhất. Mặc định 20, tối đa 100 |

**Phản hồi `200`**

```json
{
  "generated_at": "2026-12-12T19:30:03.120+07:00",
  "event": {
    "event_id": "EV001",
    "event_name": "Concert Demo",
    "admission_start": "2026-12-12T18:00:00.000+07:00",
    "admission_end": "2026-12-12T20:00:00.000+07:00",
    "gate_count": 4
  },
  "totals": {
    "total_scans": 1150,
    "fraud_count": 20,
    "warning_count": 28,
    "fraud_rate": 0.0174,
    "by_result": {
      "VALID": 1100,
      "INVALID": 6,
      "USED": 9,
      "CANCELLED": 3,
      "EXPIRED": 2,
      "WRONG_GATE": 30
    },
    "updated_at": "2026-12-12T19:30:02.000+07:00"
  },
  "gates": [
    {
      "gate_id": "GATE_A",
      "gate_name": "Cổng A",
      "total_scans": 300,
      "valid_entries": 286,
      "rejected_scans": 14,
      "fraud_count": 5,
      "warning_count": 8,
      "fraud_rate": 0.0167,
      "last_scan_at": "2026-12-12T19:30:01.874+07:00",
      "updated_at": "2026-12-12T19:30:02.000+07:00"
    }
  ],
  "latest_alerts": [
    {
      "scan_event_id": "6f1c2d1e-3b8a-4c55-9a1e-0d4c7e2b9f10",
      "created_at": "2026-12-12T19:30:01.900+07:00",
      "received_at": "2026-12-12T19:30:01.874+07:00",
      "alert_level": "FRAUD",
      "alert_code": "IMPOSSIBLE_TRAVEL",
      "scan_result": "USED",
      "ticket_id": "TK001",
      "gate_id": "GATE_D",
      "scanner_id": "SC_D1",
      "previous_scan_gate_id": "GATE_A",
      "time_since_previous_scan_ms": 3000,
      "min_travel_time_ms": 140000,
      "ticket_assigned_gate_id": null,
      "distinct_wrong_gate_count": null,
      "raw_qr_preview": null
    }
  ]
}
```


**Danh sách mọi con số trên phản hồi, và nguồn** (tên bảng Gold là đề xuất)

| Trường | Ý nghĩa | Nguồn |
|---|---|---|
| `event.*` | Thông tin sự kiện; `gate_count` đếm từ `event_gate` | `event`, `event_gate` (bảng nghiệp vụ, không phải Silver) |
| `totals.total_scans` | Tổng lượt quét của sự kiện | Gold theo sự kiện *(đề xuất `gold_event_stats.total_scans`)* |
| `totals.by_result.*` | Số lượt quét theo từng trong 6 `scan_result`. Đủ 6 khóa, thiếu thì 0. Tổng bằng `total_scans` | Gold theo sự kiện *(6 cột `cnt_valid` … `cnt_wrong_gate`)* |
| `totals.fraud_count` | Số lượt quét `alert_level = FRAUD` | Gold theo sự kiện *(`fraud_count`)* |
| `totals.warning_count` | Số lượt quét `alert_level = WARNING` | Gold theo sự kiện *(`warning_count`)* |
| `totals.fraud_rate` | `fraud_count / total_scans` | API tính từ hai số trên |
| `gates[].total_scans`, `valid_entries`, `fraud_count`, `warning_count` | Cùng ý nghĩa như trên nhưng theo cổng. `valid_entries` = số `scan_result = VALID`. `rejected_scans = total_scans − valid_entries` | Gold theo cổng *(đề xuất `gold_gate_stats`, cộng các bucket thời gian của cổng)* |
| `gates[].fraud_rate` | `fraud_count / total_scans` của cổng | API tính |
| `gates[].gate_name` | Tên hiển thị | `gate.gate_name` |
| `gates[].last_scan_at` | `received_at` lớn nhất của cổng. Giúp thấy cổng nào im lặng bất thường | Gold theo cổng *(đề xuất `last_scan_at`)* |
| `latest_alerts[]` | N cảnh báo mới nhất, sắp `created_at` giảm dần, gồm cả `WARNING` và `FRAUD` | Gold cảnh báo, **mỗi cảnh báo một dòng** *(đề xuất `gold_alert`)* |

Tổng `gates[].total_scans` = `totals.total_scans`; tổng `by_result` = `total_scans`; tổng `gates[].fraud_count` = `totals.fraud_count`.

**Trường của một cảnh báo (`latest_alerts[]`)**

| Trường | Khi nào có giá trị |
|---|---|
| `scan_event_id`, `created_at`, `received_at`, `alert_code`, `alert_level`, `scan_result`, `gate_id`, `scanner_id` | Luôn luôn có giá trị |
| `ticket_id` | `null` khi QR hỏng hoặc mã vé không có trong DB hoặc thuộc sự kiện khác (Spark gán `NULL`, file 13 dòng 3) |
| `previous_scan_gate_id`, `time_since_previous_scan_ms` | `scan_result = USED` |
| `min_travel_time_ms` | `USED` ở hai cổng khác nhau và tra được bảng thời gian đi bộ |
| `ticket_assigned_gate_id`, `distinct_wrong_gate_count` | `scan_result = WRONG_GATE` |
| `raw_qr_preview` | 24 ký tự đầu của `raw_qr_payload`, chỉ khi `ticket_id = null`, để người giám sát có cái nhìn vào mã lạ. Không trả đầy đủ vì payload chứa chữ ký HMAC. Gold chỉ lưu đoạn xem trước này, không lưu cả payload |


**API chỉ điền các trường có điều kiện đúng theo bảng trên và để `null` ở các trường hợp còn lại**, dù Gold có thể đang có giá trị. Lý do: Spark ghi `ticket_assigned_gate_id` cho **mọi** vé tra được và có cổng gán (không riêng `WRONG_GATE`), nên vé `TK001` ở file 10 sẽ mang `GATE_A` ngay cả khi lượt quét là `USED`. Quy tắc trên cho giao diện một cách hiểu duy nhất, không phụ thuộc cách Spark và Gold ghi. (file 13)

**Truy vấn cảnh báo (Nếu khác với file 14 thì tui sửa sau)**

```sql
SELECT TOP (@alerts_limit)
       scan_event_id, created_at, received_at, alert_level, alert_code, scan_result,
       ticket_id, gate_id, scanner_id, previous_scan_gate_id,
       time_since_previous_scan_ms, min_travel_time_ms,
       ticket_assigned_gate_id, distinct_wrong_gate_count, raw_qr_preview
FROM dbo.gold_alert
WHERE event_id = @event_id
ORDER BY created_at DESC;
```

**Lỗi**

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `alerts_limit` ngoài 1–100 |
| 401 / 403 | `UNAUTHENTICATED` / `FORBIDDEN` | Thiếu token / không phải `EVENT_SUPERVISOR` |
| 404 | `EVENT_NOT_FOUND` | `event_id` không tồn tại |
| 503 | `DASHBOARD_DATA_UNAVAILABLE` | Không nối được SQL Server. Giao diện hiện "mất kết nối" và giữ số liệu cũ (UC03) |

### 1.2 `GET /api/dashboard/stats`

Dữ liệu tổng hợp. Giao diện **tải một lần khi mở trang**, có nút làm mới (file 11, mục 6); không tự gọi lại theo chu kỳ.

**Query**

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `event_id` | string | Không | Mặc định `ACTIVE_EVENT_ID` |
| `bucket_minutes` | integer | Không | Độ rộng mỗi cột của biểu đồ theo thời gian: 1, 5 hoặc 10. Mặc định 1 |

**Phản hồi `200`**

```json
{
  "generated_at": "2026-12-12T19:30:03.400+07:00",
  "event": {
    "event_id": "EV001",
    "event_name": "Concert Demo",
    "admission_start": "2026-12-12T18:00:00.000+07:00",
    "admission_end": "2026-12-12T20:00:00.000+07:00",
    "gate_count": 4
  },
  "attendance": {
    "tickets_issued": 5000,
    "admitted_count": 1100,
    "admission_rate": 0.22,
    "tickets_by_status": {
      "UNUSED": 3880,
      "VALID_ENTRY": 1092,
      "FLAGGED_FRAUD": 8,
      "EXPIRED": 0,
      "CANCELLED": 20
    },
    "updated_at": "2026-12-12T19:30:03.000+07:00"
  },
  "scans": {
    "total_scans": 1150,
    "fraud_count": 20,
    "warning_count": 28,
    "fraud_rate": 0.0174,
    "by_result": { "VALID": 1100, "INVALID": 6, "USED": 9, "CANCELLED": 3, "EXPIRED": 2, "WRONG_GATE": 30 },
    "updated_at": "2026-12-12T19:30:00.000+07:00"
  },
  "alerts_by_code": [
    { "alert_code": "INVALID_QR",         "alert_level": "FRAUD",   "count": 6 },
    { "alert_code": "DUPLICATE_SCAN",     "alert_level": "FRAUD",   "count": 7 },
    { "alert_code": "IMPOSSIBLE_TRAVEL",  "alert_level": "FRAUD",   "count": 2 },
    { "alert_code": "REVOKED_TICKET",     "alert_level": "FRAUD",   "count": 3 },
    { "alert_code": "WRONG_GATE_FRAUD",   "alert_level": "FRAUD",   "count": 2 },
    { "alert_code": "WRONG_GATE_WARNING", "alert_level": "WARNING", "count": 28 }
  ],
  "alerts_updated_at": "2026-12-12T19:30:00.000+07:00",
  "gates": [
    {
      "gate_id": "GATE_A",
      "gate_name": "Cổng A",
      "total_scans": 300,
      "valid_entries": 286,
      "rejected_scans": 14,
      "fraud_count": 5,
      "warning_count": 8,
      "fraud_rate": 0.0167,
      "by_result": { "VALID": 286, "INVALID": 2, "USED": 2, "CANCELLED": 1, "EXPIRED": 1, "WRONG_GATE": 8 }
    }
  ],
  "timeline": {
    "bucket_minutes": 1,
    "truncated": false,
    "buckets": [
      { "bucket_start": "2026-12-12T18:00:00.000+07:00", "total_scans": 14, "valid_entries": 14, "fraud_count": 0, "warning_count": 0 },
      { "bucket_start": "2026-12-12T18:01:00.000+07:00", "total_scans": 31, "valid_entries": 29, "fraud_count": 1, "warning_count": 1 },
      { "bucket_start": "2026-12-12T18:02:00.000+07:00", "total_scans": 0,  "valid_entries": 0,  "fraud_count": 0, "warning_count": 0 }
    ],
    "updated_at": "2026-12-12T19:30:02.000+07:00"
  }
}
```


**Danh sách mọi con số và nguồn**

| Trường | Ý nghĩa | Nguồn |
|---|---|---|
| `attendance.tickets_issued` | Số vé phát hành của sự kiện, mọi trạng thái | `ticket` (`COUNT(*) WHERE event_id`) |
| `attendance.tickets_by_status.*` | Số vé theo từng trong 5 trạng thái, đủ 5 khóa | `ticket.ticket_status` (có chỉ mục `ticket(event_id, ticket_status)`). **Ngoại lệ có chủ đích** so với câu "cả hai đọc từ Gold" ở file 11 mục 6, xem 1.3 điểm 5 |
| `attendance.admitted_count` | Số khán giả đã vào = `VALID_ENTRY + FLAGGED_FRAUD` (vé nào đã bị gắn cờ thì trước đó đã vào một lần). Phải bằng `scans.by_result.VALID` | Tính từ `tickets_by_status` |
| `attendance.admission_rate` | `admitted_count / tickets_issued` | API tính |
| `scans.*` | Giống `totals` ở 1.1 | Gold theo sự kiện |
| `alerts_by_code[]` | Số cảnh báo theo từng mã. Đủ **6 mã**, thiếu thì 0, thứ tự cố định như ví dụ | Gold cảnh báo: `GROUP BY alert_code` trên `gold_alert` |
| `gates[]` | Như 1.1, thêm `by_result` theo cổng | Gold theo cổng |
| `timeline.buckets[]` | Mỗi phần tử là một khoảng `bucket_minutes` phút theo `received_at`: số lượt quét, số vào hợp lệ, số FRAUD, số WARNING | Gold theo cổng cộng các cổng, nhóm theo `bucket_start` |

`timeline` chạy từ khoảng phút có lượt quét đầu tiên đến khoảng phút có lượt quét cuối cùng, **điền số 0 cho các khoảng trống ở giữa** để biểu đồ liền mạch. Tối đa 360 phần tử; vượt quá thì chỉ trả 360 khoảng gần nhất và `truncated = true`. Lượt quét ngoài khung giờ nhận khách (ví dụ `EXPIRED`) vẫn nằm trong dòng thời gian.

**Ràng buộc nhất quán:** tổng `alerts_by_code[FRAUD]` = `scans.fraud_count`; `alerts_by_code[WARNING]` = `scans.warning_count`; `USED` trong `by_result` = `DUPLICATE_SCAN + IMPOSSIBLE_TRAVEL`; `admitted_count` = `by_result.VALID`; khi `truncated = false`, tổng `buckets[].total_scans` = `scans.total_scans`.

**Lỗi:** như 1.1; `400 VALIDATION_ERROR` khi `bucket_minutes` không thuộc {1, 5, 10}; `alerts_limit` không áp dụng.

## 2. Scan

### 2.1 `POST /api/scan`

Máy quét gửi một lượt quét. API bổ sung `scan_event_id`, `received_at`, `operator_id` rồi đẩy vào Kafka; Spark xử lý và ghi Silver. UC01 / F01 / F04.

**Quyền:** `GATE_OPERATOR`. `operator_id` lấy từ token (`sub`), **không** nhận từ body, theo nguyên tắc ở file 08: kết luận và định danh do phía server quyết định.

**Dữ liệu gửi lên**

| Trường | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| `raw_qr_payload` | string | Có | Không rỗng, tối đa 512 ký tự (`scan_event.raw_qr_payload NVARCHAR(512)`) |
| `ticket_id` | string hoặc null | Có điều kiện | Bắt buộc khi `decode_error = false`; phải `null` khi `decode_error = true` |
| `decode_error` | boolean | Có | |
| `gate_id` | string | Có | Phải có trong `gate` |
| `scanner_id` | string | Có | Phải có trong `scanner` **và** đặt tại đúng `gate_id` này |
| `scanned_at` | string (ISO 8601) | Có | Giờ máy quét, chỉ để hiển thị |

```json
{
  "raw_qr_payload": "TK001.9f3a...",
  "ticket_id": "TK001",
  "decode_error": false,
  "gate_id": "GATE_D",
  "scanner_id": "SC_D1",
  "scanned_at": "2026-12-12T19:00:04.120+07:00"
}
```

**Lưu ý:** API **không** kiểm tra `ticket_id` có tồn tại hay có đúng sự kiện hay không, cũng không từ chối vé lạ bằng `404`. Mã không có trong DB hoặc vé của sự kiện khác phải đi tiếp tới Spark để cho `scan_result = INVALID` và sinh cảnh báo `INVALID_QR` (R1, TC01). Trả `404` ở đây sẽ làm mất cảnh báo. Độ dài `ticket_id` không bị giới hạn 20 ký tự ở API vì mã lạ có thể dài hơn; Spark mới là nơi chuyển nó thành `ticket_id = NULL` khi không khớp bảng `ticket`.

**Phản hồi `200` — đã có kết quả**

API chờ tối đa `SCAN_WAIT_MS` (mặc định 3000 ms, hỏi lại `scan_event` mỗi 100 ms) tới khi Spark ghi xong dòng của lượt quét.

```json
{
  "scan_event_id": "6f1c2d1e-3b8a-4c55-9a1e-0d4c7e2b9f10",
  "received_at": "2026-12-12T19:00:04.150+07:00",
  "status": "COMPLETED",
  "scan_result": "USED",
  "entry": "DENY",
  "alert_level": "FRAUD",
  "alert_code": "IMPOSSIBLE_TRAVEL",
  "ticket_assigned_gate_id": null
}
```

| Trường | Mô tả |
|---|---|
| `scan_result` | Một trong `VALID`, `INVALID`, `USED`, `CANCELLED`, `EXPIRED`, `WRONG_GATE` |
| `entry` | `ALLOW` khi `scan_result = VALID`, còn lại `DENY`. Thiết bị chỉ cần đọc trường này để mở hay giữ khách |
| `alert_level`, `alert_code` | Như file 07; `NONE` và `null` khi không có cảnh báo |
| `ticket_assigned_gate_id` | API chỉ trả giá trị khi `scan_result = WRONG_GATE` (để nhân viên chỉ khách tới đúng cổng), các trường hợp khác trả `null` |

**Phản hồi `202` — chưa xử lý xong sau `SCAN_WAIT_MS`**

```json
{
  "scan_event_id": "6f1c2d1e-3b8a-4c55-9a1e-0d4c7e2b9f10",
  "received_at": "2026-12-12T19:00:04.150+07:00",
  "status": "PROCESSING"
}
```

Thiết bị **không gửi lại** `POST /scan`; nó hỏi `GET /api/scan/:scan_event_id` (2.2) cho tới khi có kết quả. Gửi lại sẽ tạo lượt quét thứ hai của cùng vé và bị coi là `USED` oan (xem 8.2).

**Mã lỗi**

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Thiếu trường, `raw_qr_payload` rỗng hoặc quá 512 ký tự, `scanned_at` sai định dạng, `decode_error = true` mà `ticket_id` khác `null`, `decode_error = false` mà thiếu `ticket_id` |
| 401 | `UNAUTHENTICATED` | Thiếu hoặc sai token |
| 403 | `FORBIDDEN` | Người dùng không phải `GATE_OPERATOR` (khớp ràng buộc ngoài CSDL ở mục 5 của file 12) |
| 422 | `UNKNOWN_GATE` | `gate_id` không có trong `gate` |
| 422 | `UNKNOWN_SCANNER` | `scanner_id` không có trong `scanner` |
| 422 | `SCANNER_GATE_MISMATCH` | Máy quét không đặt tại `gate_id` đã gửi. Nếu cho qua, Spark ghi `scan_event` sẽ vi phạm khóa ngoại `FK_scan_event_scanner` |
| 503 | `SERVICE_UNAVAILABLE` | Không đẩy được vào Kafka. Thiết bị hiển thị "không kết nối được", không tự quyết định cho vào (UC01) |

**Hành vi của API**

- `scan_event_id`: UUID v4 sinh mới mỗi lần gọi. `received_at`: giờ máy chủ, đã ghim `Asia/Ho_Chi_Minh` (không dùng `toISOString()`).
- Bản tin đẩy vào Kafka là JSON gồm đúng 9 trường của Bronze (file 13, phần A): `scan_event_id`, `raw_qr_payload`, `ticket_id`, `decode_error`, `gate_id`, `scanner_id`, `operator_id`, `scanned_at`, `received_at`. Hai trường giờ là chuỗi ISO 8601 kèm `+07:00` (Spark đọc với `spark.sql.session.timeZone=Asia/Ho_Chi_Minh`); định dạng chính xác cần A xác nhận khi viết bộ đọc.
- **Topic `scan-events`**, 3 phần vùng, **khóa phân vùng là `ticket_id`** (file 11, mục 5): mọi lượt quét của một vé đi vào cùng một phần vùng nên được xử lý theo thứ tự, điều kiện để R3 và R4 so đúng lần quét trước. `ticket_id = null` (QR hỏng) thì không đặt khóa. API nối qua `kafka:29092` (`KAFKA_INTERNAL`).
- **Bản tin lỗi:** Spark chuyển bản tin sai cấu trúc hoặc thiếu `scan_event_id`, `raw_qr_payload`, `received_at` sang `scan-events-dlq`, không ghi Bronze hay Silver (file 13, mục C.4). API luôn điền đủ ba trường này nên bản tin của API không được rơi vào đó.
- API **không ghi** `scan_event`, `fraud_alert`; chỉ Spark ghi (file 11 mục 3, file 12 mục 5). API cũng **không tự kết luận** hợp lệ hay gian lận (điều cấm 3, file 11 mục 3), kể cả không tra vé; vì vậy nó không trả `404` cho vé lạ.
- API không ghi Bronze; chỉ Spark ghi các tệp Parquet (file 11 mục 3).
- Spark ghi `scan_event` và `fraud_alert` trong **cùng một giao dịch** (file 12 mục 5, file 13 mục C.3). Việc đổi `ticket_status` **không** được nói là nằm trong giao dịch đó, nên API không hứa rằng khi `POST /scan` trả kết quả thì `GET /tickets/:id` đã thấy trạng thái mới. Xem 8.9.
- Ở chế độ `app` của file 11 mục 7 không có Kafka và Spark: `POST /scan` trả `503 SERVICE_UNAVAILABLE`, đúng như thiết kế; các endpoint khác dùng bình thường.

### 2.2 `GET /api/scan/:scan_event_id` *(đề xuất thêm, ngoài danh sách đề bài)*

Để thiết bị lấy kết quả khi `POST /scan` trả `202`. **Quyền:** `GATE_OPERATOR`.

**Phản hồi `200`:** cùng dạng với `POST /scan` (`status = COMPLETED` hoặc `PROCESSING`).

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `scan_event_id` không phải UUID |
| 404 | `SCAN_NOT_FOUND` | API không biết mã này, hoặc đã quá 5 phút kể từ lúc cấp mà vẫn chưa có kết quả |

Cách phân biệt `PROCESSING` với "không có": API giữ tạm danh sách `scan_event_id` đã cấp trong 5 phút (bộ nhớ). Mã có trong danh sách mà chưa có dòng `scan_event` → `PROCESSING`; mã lạ → `404`. MVP chạy một thể hiện API (file 11, mục 2) nên bộ nhớ là đủ; API khởi động lại thì danh sách mất.

**Lượt quét có thể không bao giờ có kết quả.** Bản tin bị chuyển sang `scan-events-dlq` thì không có dòng nào ở Silver. API luôn điền đủ các trường bắt buộc nên không nên xảy ra, nhưng nếu Spark đang tắt thì bản tin vẫn nằm trong Kafka và lượt quét ở `PROCESSING` cho đến khi quá 5 phút rồi thành `404`. Thiết bị nên ngừng hỏi sau khoảng 30 giây và báo nhân viên "chưa có kết quả", không tự cho vào hay từ chối.

### 2.3 `GET /api/scans` *(đề xuất thêm — UC05 / F06 cần)*

Tra cứu kiểm toán: danh sách lượt quét theo thời gian. **Quyền:** `EVENT_SUPERVISOR`.

**Query:** `ticket_id`, `gate_id`, `scan_result`, `alert_level`, `from`, `to` (lọc theo `received_at`, ISO 8601), `page`, `page_size`. Phải có ít nhất một trong `ticket_id`, `from`, `to`, nếu không `400` để tránh quét cả bảng.

**Phản hồi `200`:** phân trang; mỗi phần tử có đủ cột của `scan_event` (kể cả bốn cột tính toán), sắp `received_at` tăng dần (UC05, bước 3). Không có kết quả → `200` với `items: []` và `total: 0`; giao diện hiển thị "không có dữ liệu".

**Lỗi:** `400 VALIDATION_ERROR`, `401`, `403`. Phát lại luồng từ Bronze (replay) là việc của pipeline, không qua API.

---

## 3. Ticket

### 3.1 `GET /api/tickets/:id`

Tra cứu một vé. **Quyền:** cả hai vai trò.

**Phản hồi `200`**

```json
{
  "ticket_id": "TK001",
  "event_id": "EV001",
  "assigned_gate_id": "GATE_A",
  "ticket_status": "FLAGGED_FRAUD",
  "scan_count": 2,
  "valid_entry": {
    "scan_event_id": "0a7e…",
    "gate_id": "GATE_A",
    "received_at": "2026-12-12T19:00:01.000+07:00"
  },
  "last_scan": {
    "scan_event_id": "6f1c…",
    "gate_id": "GATE_D",
    "received_at": "2026-12-12T19:00:04.150+07:00",
    "scan_result": "USED"
  }
}
```

`valid_entry` là lượt quét có `scan_result = 'VALID'` của vé, `null` nếu chưa vào. `last_scan` là lượt quét mới nhất, `null` nếu chưa có lượt nào. `scan_count` đếm mọi lượt quét có `ticket_id` này.

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `:id` sai định dạng |
| 404 | `TICKET_NOT_FOUND` | Không có vé |

### 3.2 `GET /api/tickets`

**Quyền:** `EVENT_SUPERVISOR`. **Query:** `event_id`, `ticket_status`, `assigned_gate_id`, `q` (khớp đầu `ticket_id`), `page`, `page_size`. **Phản hồi:** phân trang, mỗi phần tử gồm `ticket_id`, `event_id`, `assigned_gate_id`, `ticket_status`. Lỗi: `400` nếu `ticket_status` không thuộc 5 giá trị.

### 3.3 `POST /api/tickets`

Tạo một vé. **Quyền:** `EVENT_SUPERVISOR`.

```json
{ "ticket_id": "TK010", "event_id": "EV001", "assigned_gate_id": "GATE_B" }
```

`assigned_gate_id` tùy chọn (`null` hoặc vắng = vào cổng nào cũng được). **Không nhận `ticket_status`**: vé mới luôn là `UNUSED`; nếu body có trường này → `422 FIELD_NOT_EDITABLE`.

**Phản hồi `201`:** đối tượng vé như 3.2.

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Thiếu `ticket_id` / `event_id`, sai định dạng |
| 409 | `TICKET_ALREADY_EXISTS` | Trùng `ticket_id` (UC04: trùng ID) |
| 422 | `EVENT_NOT_FOUND` | `event_id` không tồn tại |
| 422 | `GATE_NOT_IN_EVENT` | `assigned_gate_id` không nằm trong các cổng của sự kiện (khóa ngoại ghép `FK_ticket_event_gate`) |
| 422 | `FIELD_NOT_EDITABLE` | Có `ticket_status` trong body |

### 3.4 `PUT /api/tickets/:id`

Chỉ sửa được `assigned_gate_id`. `event_id` bất biến, `ticket_status` không sửa tay (file 12, mục 1: "không ai được sửa tay").

```json
{ "assigned_gate_id": "GATE_C" }
```

Gửi `null` để bỏ giới hạn cổng. **Phản hồi `200`:** vé sau khi sửa.

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 404 | `TICKET_NOT_FOUND` | |
| 409 | `TICKET_NOT_EDITABLE` | Vé không còn `UNUSED`. Đổi cổng của vé đã vào, hết hạn hoặc đã hủy là vô nghĩa. Cập nhật viết dạng `UPDATE … WHERE ticket_id = @id AND ticket_status = 'UNUSED'` để không đè lên Spark đang đổi trạng thái cùng vé |
| 422 | `GATE_NOT_IN_EVENT` | Cổng mới không thuộc sự kiện của vé |
| 422 | `FIELD_NOT_EDITABLE` | Body có `event_id` hoặc `ticket_status` |

### 3.5 `POST /api/tickets/:id/cancel`

Thu hồi vé (UC04, chuyển `UNUSED → CANCELLED`). Đây là cách duy nhất để vào `CANCELLED` bằng tay. **Quyền:** `EVENT_SUPERVISOR`. Không có body. **Phản hồi `200`:** vé với `ticket_status = CANCELLED`.

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 404 | `TICKET_NOT_FOUND` | |
| 409 | `INVALID_STATE_TRANSITION` | Vé đang `VALID_ENTRY`, `FLAGGED_FRAUD`, `EXPIRED` hoặc đã `CANCELLED` (file 06 chỉ cho `UNUSED → CANCELLED`) |

Triển khai bằng một câu lệnh nguyên tử `UPDATE ticket SET ticket_status = 'CANCELLED' WHERE ticket_id = @id AND ticket_status = 'UNUSED'`; không có dòng nào bị đổi thì xét tiếp là `404` hay `409`. Cách này tránh va chạm với Spark đang chuyển cùng vé sang `VALID_ENTRY`.

### 3.6 `DELETE /api/tickets/:id`

**Quyền:** `EVENT_SUPERVISOR`. **Phản hồi `204`.**

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 404 | `TICKET_NOT_FOUND` | |
| 409 | `TICKET_IN_USE` | Vé đã có lượt quét (`scan_event.ticket_id` tham chiếu, khóa ngoại `FK_scan_event_ticket`; lượt quét chỉ thêm, không xóa). Thông báo gợi ý dùng `cancel` |

### 3.7 `POST /api/tickets/import`

Nạp danh sách vé phát hành (UC06 / F09). **Quyền:** `EVENT_SUPERVISOR`. (Ticketing Partner gọi qua API: xem 7.3.)

**Dữ liệu gửi lên**, một trong hai dạng:

- `multipart/form-data`, trường `file` là CSV hoặc JSON.
- `application/json`: `{ "tickets": [ ... ] }`.

Mỗi dòng vé gồm:

| Trường | Bắt buộc | Mô tả |
|---|---|---|
| `ticket_id` | Có | |
| `event_id` | Có | |
| `assigned_gate_id` | Không | Rỗng hoặc `null` = không giới hạn cổng |

CSV có dòng tiêu đề `ticket_id,event_id,assigned_gate_id`, mã hóa UTF-8. Mọi vé nhập vào đều `ticket_status = 'UNUSED'`; cột `ticket_status` nếu có sẽ bị **bỏ qua**.

Giới hạn: tối đa 10 MB và 50 000 dòng mỗi lần.

**Phản hồi `200`** (kể cả khi có dòng bị từ chối; UC06 bước 3 yêu cầu báo số nhận và số từ chối):

```json
{
  "total": 5000,
  "accepted": 4998,
  "rejected": 2,
  "rejected_items": [
    { "row": 17,   "ticket_id": "TK0017", "reason_code": "DUPLICATE_TICKET" },
    { "row": 2044, "ticket_id": "TK2043", "reason_code": "GATE_NOT_IN_EVENT" }
  ]
}
```

`row` là số thứ tự dòng dữ liệu (không tính tiêu đề, bắt đầu từ 1). Các dòng hợp lệ **được ghi** dù có dòng khác bị từ chối (nhập từng phần, theo UC06).

| `reason_code` | Ý nghĩa |
|---|---|
| `MISSING_FIELD` | Thiếu `ticket_id` hoặc `event_id` |
| `INVALID_ID_FORMAT` | ID sai định dạng |
| `DUPLICATE_IN_FILE` | `ticket_id` xuất hiện lần thứ hai trong cùng tệp (giữ dòng đầu) |
| `DUPLICATE_TICKET` | `ticket_id` đã có trong hệ thống (giữ bản ghi cũ, UC06) |
| `EVENT_NOT_FOUND` | `event_id` không có trong `event` |
| `GATE_NOT_IN_EVENT` | `assigned_gate_id` không thuộc các cổng của sự kiện |

**Lỗi cả tệp (không ghi dòng nào)**

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `INVALID_FORMAT` | Tệp không đọc được, sai tiêu đề CSV, JSON hỏng |
| 413 | `PAYLOAD_TOO_LARGE` | Quá 10 MB hoặc 50 000 dòng |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Không phải CSV hoặc JSON |

---

## 4. Event, Gate, Scanner

Cả ba nhóm: **quyền `EVENT_SUPERVISOR`**, phản hồi tạo mới là `201`, xóa là `204`.

### 4.1 Event

| Phương thức, đường dẫn | Mô tả |
|---|---|
| `POST /api/events` | Tạo sự kiện kèm danh sách cổng |
| `GET /api/events` | Danh sách, phân trang |
| `GET /api/events/:id` | Chi tiết |
| `PUT /api/events/:id` | Sửa tên, khung giờ, danh sách cổng |
| `DELETE /api/events/:id` | Xóa |

**Đối tượng event**

```json
{
  "event_id": "EV001",
  "event_name": "Concert Demo",
  "admission_start": "2026-12-12T18:00:00.000+07:00",
  "admission_end": "2026-12-12T20:00:00.000+07:00",
  "gate_ids": ["GATE_A", "GATE_B", "GATE_C", "GATE_D"],
  "gate_count": 4,
  "is_active": true
}
```

`gate_count` là thuộc tính dẫn xuất (đếm `event_gate`), không lưu. `is_active` = `event_id == ACTIVE_EVENT_ID`, chỉ trả về, không ghi được.

**`POST` / `PUT` body:** `event_id` (chỉ `POST`), `event_name`, `admission_start`, `admission_end`, `gate_ids` (mảng, **ít nhất 1 phần tử** vì sự kiện tham gia toàn phần vào `event_gate`). `PUT` thay toàn bộ `gate_ids`. Ghi `event` và `event_gate` trong một giao dịch. **Thận trọng khi sửa `gate_ids` của sự kiện đang chạy:** số cổng `N` đếm từ `event_gate` (file 12, file) và quyết định ngưỡng `WRONG_GATE_FRAUD = N − 1`; thêm hoặc bớt cổng giữa chừng làm đổi ngưỡng cho các lượt quét sau đó.

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Thiếu trường, sai kiểu, `gate_ids` rỗng |
| 404 | `EVENT_NOT_FOUND` | `GET`, `PUT`, `DELETE` |
| 409 | `EVENT_ALREADY_EXISTS` | `POST` trùng `event_id` |
| 409 | `EVENT_IN_USE` | `DELETE` khi sự kiện đã có vé (`FK_ticket_event`). `PUT` bỏ một cổng đang là `assigned_gate_id` của vé (`FK_ticket_event_gate`) cũng trả mã này, kèm `details` liệt kê cổng |
| 422 | `INVALID_ADMISSION_WINDOW` | `admission_end` không sau `admission_start` (`CK_event_window`) |
| 422 | `GATE_NOT_FOUND` | Một phần tử `gate_ids` không có trong `gate` |

### 4.2 Gate

| Phương thức, đường dẫn | Mô tả |
|---|---|
| `POST /api/gates` | Body `{ "gate_id", "gate_name" }` |
| `GET /api/gates` | Danh sách |
| `GET /api/gates/:id` | Chi tiết, kèm `scanner_ids` của cổng |
| `PUT /api/gates/:id` | Chỉ sửa `gate_name` |
| `DELETE /api/gates/:id` | Xóa |

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Thiếu `gate_id` / `gate_name`, `gate_name` quá 100 ký tự |
| 404 | `GATE_NOT_FOUND` | |
| 409 | `GATE_ALREADY_EXISTS` | Trùng `gate_id` |
| 409 | `GATE_IN_USE` | `DELETE` khi cổng còn được tham chiếu: `event_gate`, `scanner`, `gate_travel_time` hoặc `scan_event` |

### 4.3 Scanner

| Phương thức, đường dẫn | Mô tả |
|---|---|
| `POST /api/scanners` | Body `{ "scanner_id", "gate_id" }` |
| `GET /api/scanners` | Danh sách; query `gate_id` để lọc |
| `GET /api/scanners/:id` | Chi tiết |
| `PUT /api/scanners/:id` | Chỉ sửa `gate_id` (chuyển máy sang cổng khác) |
| `DELETE /api/scanners/:id` | Xóa |

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Thiếu trường, sai định dạng |
| 404 | `SCANNER_NOT_FOUND` | |
| 409 | `SCANNER_ALREADY_EXISTS` | Trùng `scanner_id` |
| 409 | `SCANNER_IN_USE` | `PUT` đổi cổng hoặc `DELETE` khi máy đã có lượt quét: `FK_scan_event_scanner` tham chiếu `(scanner_id, gate_id)`, lượt quét cũ sẽ lệch cổng |
| 422 | `GATE_NOT_FOUND` | `gate_id` không tồn tại |

---

## 5. Login

### `POST /api/login`

Không cần token.

```json
{ "username": "operator01", "password": "••••••••" }
```

**Phản hồi `200`**

```json
{
  "access_token": "eyJhbGciOi…",
  "token_type": "Bearer",
  "expires_in": 43200,
  "user": {
    "user_id": "U001",
    "username": "operator01",
    "last_name": "Nguyễn",
    "first_name": "An",
    "role": "GATE_OPERATOR"
  }
}
```

`user.user_id` chính là `operator_id` gắn vào lượt quét. `password_hash` và `phone` không bao giờ trả về.

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Thiếu `username` hoặc `password` |
| 401 | `INVALID_CREDENTIALS` | Sai tên đăng nhập **hoặc** sai mật khẩu. Một thông báo chung cho cả hai, không tiết lộ tài khoản có tồn tại hay không |

So mật khẩu bằng bcrypt với `app_user.password_hash`.

---

## 6. Ma trận đọc/ghi bảng

Ký hiệu: **R** đọc, **W** ghi (thêm hoặc sửa), **D** xóa. Cột ghi trong ngoặc.

| Endpoint | Đọc | Ghi |
|---|---|---|
| `POST /scan` | `scanner` (scanner_id, gate_id); `gate` (gate_id); `app_user` (user_id, role) cho kiểm tra `GATE_OPERATOR` *(có thể lấy từ claim `role` của token, khi đó không cần đọc)* | Không ghi SQL Server. Ghi Kafka (topic `scan-events`) |
| `GET /scan/:id` | `scan_event` (scan_event_id, scan_result, alert_level, alert_code, ticket_assigned_gate_id) | — |
| `GET /scans` | `scan_event` (mọi cột) | — |
| `GET /tickets/:id` | `ticket` (mọi cột); `scan_event` (ticket_id, scan_event_id, gate_id, received_at, scan_result) | — |
| `GET /tickets` | `ticket` | — |
| `POST /tickets` | `event` (event_id), `event_gate` (event_id, gate_id), `ticket` (ticket_id) | `ticket` W (ticket_id, event_id, assigned_gate_id; ticket_status lấy mặc định `UNUSED`) |
| `PUT /tickets/:id` | `ticket`, `event_gate` | `ticket` W (assigned_gate_id) |
| `POST /tickets/:id/cancel` | `ticket` | `ticket` W (ticket_status) |
| `DELETE /tickets/:id` | `ticket`, `scan_event` (ticket_id) | `ticket` D |
| `POST /tickets/import` | `event`, `event_gate`, `ticket` (ticket_id) | `ticket` W (ticket_id, event_id, assigned_gate_id) |
| `POST /events`, `PUT /events/:id` | `event`, `gate`, `ticket` (assigned_gate_id, khi bỏ cổng) | `event` W (event_id, event_name, admission_start, admission_end); `event_gate` W/D |
| `GET /events`, `/events/:id` | `event`, `event_gate` | — |
| `DELETE /events/:id` | `event`, `ticket` (event_id) | `event` D, `event_gate` D |
| `POST /gates`, `PUT /gates/:id` | `gate` | `gate` W (gate_id, gate_name) |
| `GET /gates`, `/gates/:id` | `gate`, `scanner` (scanner_id) | — |
| `DELETE /gates/:id` | `event_gate`, `scanner`, `gate_travel_time`, `scan_event` (gate_id) | `gate` D |
| `POST /scanners`, `PUT /scanners/:id` | `scanner`, `gate`, `scan_event` (scanner_id) | `scanner` W (scanner_id, gate_id) |
| `GET /scanners`, `/scanners/:id` | `scanner` | — |
| `DELETE /scanners/:id` | `scan_event` (scanner_id) | `scanner` D |
| `POST /login` | `app_user` (user_id, username, password_hash, last_name, first_name, role) | — |
| `GET /dashboard/live` | `event`, `event_gate`, `gate` (gate_name), Gold theo sự kiện, Gold theo cổng, Gold cảnh báo (mọi cột ở 1.1). **Không** đọc `scan_event`, `fraud_alert` | — |
| `GET /dashboard/stats` | `event`, `event_gate`, `gate`, `ticket` (event_id, ticket_status), Gold theo sự kiện, Gold theo cổng (kể cả bucket thời gian), Gold cảnh báo. **Không** đọc `scan_event`, `fraud_alert` | — |

**Ai ghi bảng nào**

| Bảng | Người ghi |
|---|---|
| `scan_event`, `fraud_alert` | Chỉ Spark. API và dashboard chỉ đọc (file 12, mục 5). `.env` ở file 11 mục 8 chỉ có một `DB_USER=sa` dùng chung, nên ở MVP quy ước "API chỉ đọc" nằm ở mã API, chưa do CSDL ép (xem 7.10) |
| Bronze (Parquet), Gold | Chỉ Spark (file 11, mục 3). API không ghi tệp và không ghi bảng Gold |
| `ticket.ticket_status` | Spark (`UNUSED → VALID_ENTRY → FLAGGED_FRAUD`), tiến trình đóng cổng (`→ EXPIRED`), và API qua `import` / `cancel` |
| `event`, `event_gate`, `gate`, `scanner`, `ticket` (ngoài `ticket_status`) | API |
| `gate_travel_time`, `app_user` | Chỉ nạp bằng `seed.sql` (xem 7.5 và 7.6) |

---

## 7. Cột/bảng còn thiếu trong schema (báo C)

Chia hai nhóm: **ảnh hưởng tới API ngay** (7.1–7.4) và **ghi nhận, chưa chặn MVP** (7.5–7.10).

### 7.1 `scan_event` không có `event_id`

File 12 chủ ý bỏ vì "mỗi lần chạy chỉ phục vụ một sự kiện". File 11 mục 8 nói rõ hơn: cơ sở dữ liệu **có thể chứa nhiều sự kiện**, mỗi lần chạy chỉ phục vụ sự kiện `ACTIVE_EVENT_ID`, đổi sự kiện thì sửa biến rồi khởi động lại. Nghĩa là lượt quét của các lần chạy khác nhau cùng nằm trong một bảng `scan_event` và không cột nào phân biệt được. Hệ quả cho API:

- `GET /scans` không lọc được theo sự kiện, chỉ theo thời gian hoặc vé.
- Lượt quét `INVALID` (`ticket_id = NULL`) và lượt quét vé sự kiện khác không suy ra được sự kiện qua `ticket`.
- Gold phải tự mang `event_id` do Spark gắn từ `ACTIVE_EVENT_ID` (đã đề xuất ở 1.3).
- Sau lần chạy thứ hai, mọi truy vấn trực tiếp vào `scan_event` phải kèm khoảng thời gian, nếu không sẽ trộn hai sự kiện.

**Đề xuất:** thêm `event_id NVARCHAR(20) NULL` (khóa ngoại tới `event`) vào `scan_event` để Spark gắn `ACTIVE_EVENT_ID`; file 13 cần thêm một dòng cho cột này (cột thứ 26, thuộc nhóm Spark tính ra). Nếu không thêm thì quy ước `GET /scans` luôn phải có `from` và `to`.

### 7.2 Chưa có chỉ mục nào ngoài PK / UQ

`init.sql` không tạo chỉ mục phụ. SQL Server không tự đánh chỉ mục cho khóa ngoại. Các truy vấn trong tài liệu này cần:

| Chỉ mục đề xuất | Phục vụ |
|---|---|
| `scan_event (ticket_id, received_at)` | `GET /tickets/:id`, `GET /scans?ticket_id=`, và việc Spark tìm lượt quét trước (R3/R4) nếu nó tra từ SQL Server thay vì từ state store |
| `scan_event (received_at)` | `GET /scans?from=&to=` |
| `gold_alert (event_id, created_at DESC)` (sau khi có file 14 tui mới xử lý được phần này) | `latest_alerts` của `live`, gọi mỗi giây |
| `ticket (event_id, ticket_status)` | `tickets_by_status` của `stats`, `GET /tickets` |



### 7.3 `gate_travel_time` chưa có endpoint

Bảng này quyết định R4 nhưng đề bài không liệt kê endpoint quản lý. **MVP:** chỉ nạp bằng `seed.sql`, kèm truy vấn kiểm tra đối xứng ở `checks.sql`. Nếu cần sửa trên giao diện, đề xuất `GET /api/gate-travel-times` và `PUT /api/gate-travel-times/:gate_id_1/:gate_id_2` (API ghi cả hai chiều trong một giao dịch).


### 7.4 `ticket` không lưu dấu vết thao tác

Không có `created_at`, `cancelled_at`, `cancelled_by`. `POST /tickets/:id/cancel` không ghi được ai thu hồi và lúc nào. Nếu cần kiểm toán cho UC04 thì thêm các cột này (cho phép NULL).

### 7.5 Cổng của lượt quét không bị buộc thuộc sự kiện đang chạy

`scan_event.gate_id` chỉ có khóa ngoại tới `gate`, không tới `event_gate`. Một máy quét đặt ở cổng không nằm trong danh sách cổng của sự kiện vẫn gửi và được ghi bình thường, và con số `N` (số cổng của sự kiện, dùng cho ngưỡng `WRONG_GATE_FRAUD`) sẽ không tính cổng đó. `POST /scan` hiện **không** chặn trường hợp này. Nếu muốn chặn thì API phải đọc `event_gate` với `ACTIVE_EVENT_ID` và trả `422 GATE_NOT_IN_EVENT`; đề xuất để sau MVP.


