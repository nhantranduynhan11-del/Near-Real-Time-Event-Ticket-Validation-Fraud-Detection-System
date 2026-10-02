# 13 — Bronze & Silver Layer Specification (Design)

Tài liệu này đặc tả chi tiết kiến trúc lưu trữ, tổ chức thư mục tầng **Bronze** (Dữ liệu thô) và ma trận đối chiếu chuyển đổi sang bảng `SCAN_EVENT` tại tầng **Silver** (Dữ liệu đã qua xử lý nghiệp vụ) theo mô hình Medallion Architecture.

---

## Phần A. Tầng Bronze (Raw Scan Events)

Tầng Bronze có nhiệm vụ lưu trữ nguyên bản toàn bộ sự kiện quét vé được API đẩy vào Kafka topic `scan-events`. Dữ liệu tại đây mang tính bất biến (append-only), đóng vai trò là nhật ký kiểm toán (Audit Log) và nguồn gốc dữ liệu phục vụ đối soát, tra cứu hoặc replay luồng xử lý.

### 1. Bố cục cây thư mục và Phân vùng (Partitioning)

Dữ liệu được lưu trực tiếp trên hệ thống tệp tại môi trường WSL2. Thư mục được chia theo chiến lược phân vùng dạng Hive-partition, cụ thể là phân cấp theo **Ngày (`year`, `month`, `day`)** rồi đến **Giờ (`hour`)**. Mốc thời gian dùng để phân vùng bắt buộc phải là trường `received_at` (giờ API nhận request theo chuẩn giờ Việt Nam UTC+7).

**Cấu trúc thư mục mẫu:**
```text
data/bronze/scan_events/
└── year=2026/
    └── month=12/
        └── day=12/
            ├── hour=18/
            │   ├── part-00000-7f8b9a2c-1234-4567-89ab-cdef01234567.c000.snappy.parquet
            │   ├── part-00001-8e9c0b3d-2345-5678-9abc-def012345678.c000.snappy.parquet
            │   └── _SUCCESS
            ├── hour=19/
            │   ├── part-00000-9f0a1c4e-3456-6789-abcd-ef0123456789.c000.snappy.parquet
            │   └── _SUCCESS
            └── hour=20/
                ├── part-00000-b12c3e6a-5678-89ab-cdef-0123456789ab.c000.snappy.parquet
                └── _SUCCESS
```

### 2. Định dạng lưu trữ và Quy ước đặt tên tệp

- **Định dạng dữ liệu:** `Apache Parquet`.
- **Chuẩn nén:** `Snappy` (Tối ưu hóa tốc độ đọc/ghi cho Spark).
- **Quy ước đặt tên tệp:** Tệp do Spark Streaming sinh ra theo micro-batch phải tuân thủ cú pháp:
  `part-<partition_id:05d>-<random_uuid>.c<batch_id:03d>.snappy.parquet`
- **Tệp `_SUCCESS`:** Một tệp rỗng được sinh ra trong từng phân vùng giờ (`hour=...`) ngay khi batch ghi hoàn tất, báo hiệu dữ liệu trong thư mục đó đã sẵn sàng để đọc.

### 3. Cấu trúc trường dữ liệu Bronze

Dữ liệu tại tầng Bronze bảo toàn nguyên vẹn 9 trường Input từ đặc tả sự kiện quét thô:

| STT | Tên trường (Field Name) | Kiểu dữ liệu Spark | Bắt buộc | Nguồn sinh | Mô tả chi tiết |
|:---:|:---|:---|:---:|:---|:---|
| 1 | `scan_event_id` | `StringType` | Bắt buộc | API Gateway | UUID v4 định danh duy nhất cho một lượt quét (request API). Khóa định danh của event. |
| 2 | `raw_qr_payload` | `StringType` | Bắt buộc | Scanner | Chuỗi thô đọc trực tiếp từ QR code (bao gồm payload vé và HMAC). Không được rỗng. |
| 3 | `ticket_id` | `StringType` | Bắt buộc khi `decode_error = false`, NULL khi `= true` | Scanner | Mã vé được giải mã tại chỗ trên scanner. Nếu giải mã thất bại thì mang giá trị NULL. |
| 4 | `decode_error` | `BooleanType` | Bắt buộc | Scanner | Cờ báo lỗi giải mã (`true`: lỗi giải mã QR, `false`: giải mã thành công). |
| 5 | `gate_id` | `StringType` | Bắt buộc | Config thiết bị | Mã cổng thực hiện quét vé (`GATE_A`, `GATE_B`, `GATE_C`, `GATE_D`). |
| 6 | `scanner_id` | `StringType` | Bắt buộc | Config thiết bị | Mã thiết bị phần cứng thực hiện quét (`SC_A1`, `SC_B1`,...). Duy nhất theo máy. |
| 7 | `operator_id` | `StringType` | Tùy chọn (NULL) | Scanner / Session | Mã nhân viên soát vé (`user_id` trong `APP_USER`). Để trống/NULL nếu không yêu cầu login. |
| 8 | `scanned_at` | `TimestampType` | Bắt buộc | Scanner | Giờ ghi nhận trên máy quét (client clock, giờ Việt Nam UTC+7). Chỉ dùng hiển thị. |
| 9 | `received_at` | `TimestampType` | Bắt buộc | API Gateway | Giờ API nhận request (server clock, giờ Việt Nam UTC+7). Mốc chuẩn tính toán và phân vùng. |

---

## Phần B. Đối chiếu tầng Silver (Bảng `SCAN_EVENT`)

Tầng Silver nhận dữ liệu từ Kafka, Spark tính toán áp dụng luật nghiệp vụ (phát hiện gian lận, trừ thời gian, chuyển trạng thái vé) rồi ghi vào bảng `SCAN_EVENT` trên SQL Server. Bảng này có tổng cộng 25 cột.

Bảng dưới đây ánh xạ 1-1 từng trường của sự kiện với từng cột trong DB, phân rõ trách nhiệm sinh dữ liệu thuộc về luồng nào: **Chép nguyên**, **Spark tính ra**, hay **SQL Server tự tính**.

| STT | Trường dữ liệu (File 08) | Cột trong bảng `SCAN_EVENT` (File 12) | Cơ chế sinh dữ liệu | Chi tiết xử lý logic |
|:---:|:---|:---|:---|:---|
| **1** | `scan_event_id` | `scan_event_id` (PK) | **Chép nguyên** | Đẩy thẳng chuỗi UUID v4 từ API sinh. SQL Server tự động nhận diện dưới dạng kiểu `UNIQUEIDENTIFIER` 16-byte. |
| **2** | `raw_qr_payload` | `raw_qr_payload` | **Chép nguyên** | Bê nguyên chuỗi payload gốc của Bronze sang. |
| **3** | `ticket_id` | `ticket_id` (FK) | **Spark tính ra** | Lấy từ Bronze. **Tuy nhiên**, nếu mã vé không có thật trong bảng `TICKET`, thuộc sự kiện khác (`ACTIVE_EVENT_ID`), hoặc `decode_error = 1`, Spark bắt buộc gán thành `NULL` để không vi phạm khóa ngoại `FK_scan_event_ticket`. Mã gốc vẫn bảo toàn trong `raw_qr_payload`. |
| **4** | `decode_error` | `decode_error` | **Chép nguyên** | Lấy nguyên giá trị boolean của Bronze (SQL Server nhận giá trị 0 hoặc 1 của kiểu `BIT`). |
| **5** | `gate_id` | `gate_id` (FK) | **Chép nguyên** | Lấy nguyên mã cổng từ bản tin Bronze. |
| **6** | `scanner_id` | `scanner_id` (FK) | **Chép nguyên** | Lấy nguyên mã máy quét từ bản tin Bronze. |
| **7** | `operator_id` | `operator_id` (FK) | **Chép nguyên** | Lấy nguyên từ bản tin Bronze. Giữ nguyên `NULL` nếu máy quét không gửi mã nhân viên. |
| **8** | `scanned_at` | `scanned_at` | **Chép nguyên** | Giữ nguyên mốc thời gian máy quét đọc mã. |
| **9** | `received_at` | `received_at` | **Chép nguyên** | Giữ nguyên mốc thời gian hệ thống API tiếp nhận (UTC+7). |
| **10**| `processing_ts` | `processing_ts` | **Spark tính ra** | Spark chủ động đánh mốc thời gian khi batch xử lý hoàn tất sự kiện này (`processing_ts >= received_at`). |
| **11**| `ticket_status_before` | `ticket_status_before` | **Spark tính ra** | Spark tra cứu State Store (hoặc DB). Trả về 1 trong 5 trạng thái vé trước khi bị quét. Trả `NULL` nếu không tìm thấy vé hợp lệ hoặc lỗi giải mã. |
| **12**| `ticket_status_after` | `ticket_status_after` | **Spark tính ra** | Spark xác định dựa trên `scan_result`. Đổi thành `VALID_ENTRY` nếu kết quả là `VALID`. Đổi thành `FLAGGED_FRAUD` nếu kết quả `USED` trên vé đang `VALID_ENTRY`. Còn lại chép y nguyên từ `ticket_status_before`. |
| **13**| `scan_result` | `scan_result` | **Spark tính ra** | Spark chạy qua 6 bước thứ tự ưu tiên (Precedence) để ra đúng 1 kết quả duy nhất: `VALID`, `INVALID`, `USED`, `CANCELLED`, `EXPIRED`, `WRONG_GATE`. |
| **14**| `alert_level` | `alert_level` | **Spark tính ra** | Spark map từ `scan_result` ra 1 trong 3 mức cảnh báo: `NONE`, `WARNING`, `FRAUD`. |
| **15**| `alert_code` | `alert_code` | **Spark tính ra** | Spark map ra mã cụ thể (`INVALID_QR`, `DUPLICATE_SCAN`, `IMPOSSIBLE_TRAVEL`, `REVOKED_TICKET`, `WRONG_GATE_WARNING`, `WRONG_GATE_FRAUD`). Gán `NULL` nếu `alert_level = NONE`. |
| **16**| `previous_scan_event_id` | `previous_scan_event_id` (FK) | **Spark tính ra** | Lấy UUID của lần quét hợp lệ gần nhất từ State Store. Bắt buộc có khi result là `USED`, ngược lại gán `NULL`. |
| **17**| `previous_scan_gate_id` | `previous_scan_gate_id` | **Spark tính ra** | Lấy mã cổng của lần quét hợp lệ trước từ State Store. Bắt buộc có khi result là `USED`, ngược lại gán `NULL`. |
| **18**| `time_since_previous_scan_ms` | `time_since_previous_scan_ms` | **Spark tính ra** | Spark tính bằng cách trừ hai mốc **`received_at`** (tuyệt đối không dùng `scanned_at`): `received_at (hiện tại) - received_at (lần quét trước)`. |
| **19**| `min_travel_time_ms` | `min_travel_time_ms` | **Spark tính ra** | Spark dò bảng dữ liệu thời gian đi bộ tối thiểu giữa cặp `gate_id` trước và hiện tại (`GATE_TRAVEL_TIME`). Gán `NULL` nếu cùng cổng hoặc dữ liệu cấu hình bị thiếu. |
| **20**| `ticket_assigned_gate_id` | `ticket_assigned_gate_id` | **Spark tính ra** | Spark gán ảnh chụp mã cổng được phân bổ của vé tra từ Master Data. Gán `NULL` nếu vé tự do không chỉ định cổng. |
| **21**| `distinct_wrong_gate_count` | `distinct_wrong_gate_count` | **Spark tính ra** | Spark sử dụng State Store đếm tích lũy số lượng cổng sai khác nhau. Bắt buộc có dữ liệu nếu result = `WRONG_GATE`. Tối đa bằng $N - 1$ cổng (với $N$ là số cổng mà sự kiện của vé mở trong bảng `EVENT_GATE`). |
| **22**| `is_duplicate` | `is_duplicate` (PERSISTED) | **SQL Server tự tính** | Cột tính toán lưu trữ. Công thức SQL: `CAST(CASE WHEN scan_result = 'USED' THEN 1 ELSE 0 END AS BIT)`. |
| **23**| `is_wrong_gate` | `is_wrong_gate` (PERSISTED) | **SQL Server tự tính** | Cột tính toán lưu trữ. Công thức SQL: `CAST(CASE WHEN scan_result = 'WRONG_GATE' THEN 1 ELSE 0 END AS BIT)`. |
| **24**| `fraud_alert` | `fraud_alert` (PERSISTED) | **SQL Server tự tính** | Cột tính toán lưu trữ. Công thức SQL: `CAST(CASE WHEN alert_level = 'FRAUD' THEN 1 ELSE 0 END AS BIT)`. Dùng để thống kê gian lận thật trên Dashboard. |
| **25**| `ingestion_lag_ms` | `ingestion_lag_ms` (PERSISTED) | **SQL Server tự tính** | Cột đo độ trễ pipeline. Công thức SQL: `DATEDIFF(MILLISECOND, received_at, processing_ts)`. |

---

## Phần C. Quy tắc tích hợp tầng Pipeline (Implementation Rules)

1. **Giới hạn số cột khi ghi JDBC:**
   - Bảng `SCAN_EVENT` có tổng cộng **25 cột**.
   - Có **4 cột tự tính bởi SQL Server** (`is_wrong_gate`, `is_duplicate`, `fraud_alert`, `ingestion_lag_ms`) được định nghĩa là **Computed PERSISTED Columns** ở cấp độ Database.
   - Do đó, khi Spark DataFrame thực hiện lệnh ghi (`.write.jdbc`), **tuyệt đối chỉ truyền 21 cột**. Bất kỳ nỗ lực nào chèn giá trị (kể cả truyền `NULL`) vào 4 cột tính toán này sẽ khiến SQL Server ném lỗi từ chối Transaction ngay lập tức.
2. **Xử lý toàn vẹn dữ liệu ngoại lệ cho `ticket_id`:**
   - Trong bản tin thô Bronze, `ticket_id` có thể chứa mã vé không tồn tại trong DB, vé của sự kiện khác, hoặc bị lỗi giải mã do đọc QR hỏng.
   - Khi chuyển sang Silver, để không vi phạm ràng buộc khóa ngoại `FK_scan_event_ticket`, Spark bắt buộc phải lọc và gán `ticket_id = NULL` đối với các trường hợp ngoại lệ này.
   - Lịch sử mã quét lỗi vẫn luôn được bảo toàn nguyên vẹn tại cột `raw_qr_payload`.
3. **Đồng bộ hóa bảng `FRAUD_ALERT`:**
   - Đối với các bản tin có `alert_level` khác `NONE` (`WARNING` hoặc `FRAUD`), Spark phải thực hiện ghi đồng thời bản ghi sự kiện vào `SCAN_EVENT` và chi tiết cảnh báo vào bảng thực thể yếu `FRAUD_ALERT` trong **cùng một giao dịch (Transaction)** để đảm bảo tính nhất quán dữ liệu tuyệt đối.
4. **Xử lý bản tin lỗi schema (Dead Letter Queue - DLQ):**
   - Các bản tin đẩy lên Kafka bị lỗi cấu trúc định dạng JSON (malformed payload) hoặc thiếu các trường bắt buộc (`scan_event_id`, `raw_qr_payload`, `received_at`) sẽ được chuyển hướng trực tiếp sang topic `scan-events-dlq`, không ghi xuống tầng Bronze hay Silver.
