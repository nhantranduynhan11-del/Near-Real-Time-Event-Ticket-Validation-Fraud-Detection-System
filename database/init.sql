/* =====================================================================
   init.sql — Tạo cơ sở dữ liệu ticket_system (SQL Server 2022)
   Nguồn thiết kế: Design/12_Database_Schema.md

   Chạy được nhiều lần: bảng nào đã có thì bỏ qua, không xóa dữ liệu.
   Muốn tạo lại từ đầu sau khi đổi thiết kế: xóa volume của SQL Server
   (docker compose down -v) rồi khởi động lại.

   Quy ước:
     - Mọi chuỗi là NVARCHAR, collation Vietnamese_CI_AS.
     - Mọi mốc thời gian là giờ Việt Nam (UTC+7, Asia/Ho_Chi_Minh),
       kiểu DATETIME2(3). API, Spark và Docker phải ghim cùng múi giờ này
       (xem Design/11_Architecture.md, mục 8).
     - Các CHECK liệt kê giá trị dùng COLLATE Latin1_General_100_BIN2
       để chỉ nhận đúng chữ hoa (vì Vietnamese_CI_AS không phân biệt
       hoa thường, 'unused' sẽ lọt qua nếu không ép).
   ===================================================================== */

IF DB_ID(N'ticket_system') IS NULL
    CREATE DATABASE ticket_system COLLATE Vietnamese_CI_AS;
GO

USE ticket_system;
GO

/* ---------------------------------------------------------------------
   1. EVENT
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.[event]', N'U') IS NULL
CREATE TABLE dbo.[event] (
    event_id         NVARCHAR(20)  NOT NULL,
    event_name       NVARCHAR(200) NOT NULL,
    admission_start  DATETIME2(3)  NOT NULL,   -- giờ Việt Nam
    admission_end    DATETIME2(3)  NOT NULL,   -- giờ Việt Nam

    CONSTRAINT PK_event PRIMARY KEY (event_id),
    CONSTRAINT CK_event_window CHECK (admission_end > admission_start)
);
GO

/* ---------------------------------------------------------------------
   2. GATE
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.gate', N'U') IS NULL
CREATE TABLE dbo.gate (
    gate_id    NVARCHAR(20)  NOT NULL,
    gate_name  NVARCHAR(100) NOT NULL,

    CONSTRAINT PK_gate PRIMARY KEY (gate_id)
);
GO

/* ---------------------------------------------------------------------
   3. EVENT_GATE  (liên kết M:N OPENS)
   Ràng buộc tham gia toàn phần của EVENT kiểm tra trong checks.sql.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.event_gate', N'U') IS NULL
CREATE TABLE dbo.event_gate (
    event_id  NVARCHAR(20) NOT NULL,
    gate_id   NVARCHAR(20) NOT NULL,

    CONSTRAINT PK_event_gate PRIMARY KEY (event_id, gate_id),
    CONSTRAINT FK_event_gate_event FOREIGN KEY (event_id) REFERENCES dbo.[event] (event_id),
    CONSTRAINT FK_event_gate_gate  FOREIGN KEY (gate_id)  REFERENCES dbo.gate (gate_id)
);
GO

/* ---------------------------------------------------------------------
   4. GATE_TRAVEL_TIME  (liên kết đệ quy M:N WALK_TIME)
   Mỗi cặp cổng lưu cả hai chiều. Tính đối xứng kiểm tra trong checks.sql.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.gate_travel_time', N'U') IS NULL
CREATE TABLE dbo.gate_travel_time (
    gate_id_1           NVARCHAR(20) NOT NULL,
    gate_id_2           NVARCHAR(20) NOT NULL,
    min_travel_time_ms  INT          NOT NULL,

    CONSTRAINT PK_gate_travel_time PRIMARY KEY (gate_id_1, gate_id_2),
    CONSTRAINT FK_gate_travel_time_gate_1 FOREIGN KEY (gate_id_1) REFERENCES dbo.gate (gate_id),
    CONSTRAINT FK_gate_travel_time_gate_2 FOREIGN KEY (gate_id_2) REFERENCES dbo.gate (gate_id),
    CONSTRAINT CK_gate_travel_time_diff CHECK (gate_id_1 <> gate_id_2),
    CONSTRAINT CK_gate_travel_time_pos  CHECK (min_travel_time_ms > 0)
);
GO

/* ---------------------------------------------------------------------
   5. SCANNER
   UQ (scanner_id, gate_id) là đích của khóa ngoại ghép từ scan_event,
   bảo đảm máy quét ghi trên lượt quét đúng là máy đặt tại cổng đó.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.scanner', N'U') IS NULL
CREATE TABLE dbo.scanner (
    scanner_id  NVARCHAR(20) NOT NULL,
    gate_id     NVARCHAR(20) NOT NULL,

    CONSTRAINT PK_scanner PRIMARY KEY (scanner_id),
    CONSTRAINT FK_scanner_gate FOREIGN KEY (gate_id) REFERENCES dbo.gate (gate_id),
    CONSTRAINT UQ_scanner_scanner_gate UNIQUE (scanner_id, gate_id)
);
GO

/* ---------------------------------------------------------------------
   6. APP_USER  (lớp cha + hai lớp con gộp, phân loại bằng role)
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.app_user', N'U') IS NULL
CREATE TABLE dbo.app_user (
    user_id        NVARCHAR(20)  NOT NULL,
    username       NVARCHAR(50)  NOT NULL,
    password_hash  NVARCHAR(255) NOT NULL,   -- bcrypt, không lưu mật khẩu gốc
    last_name      NVARCHAR(50)  NOT NULL,
    first_name     NVARCHAR(50)  NOT NULL,
    phone          NVARCHAR(15)  NULL,
    role           NVARCHAR(20)  NOT NULL,

    CONSTRAINT PK_app_user PRIMARY KEY (user_id),
    CONSTRAINT UQ_app_user_username UNIQUE (username),
    CONSTRAINT CK_app_user_phone CHECK (phone IS NULL OR (LEN(phone) >= 8 AND phone NOT LIKE N'%[^0-9+]%')),
    CONSTRAINT CK_app_user_role CHECK (role COLLATE Latin1_General_100_BIN2 IN (N'GATE_OPERATOR', N'EVENT_SUPERVISOR'))
);
GO

/* ---------------------------------------------------------------------
   7. TICKET
   (event_id, assigned_gate_id) trỏ vào event_gate: vé chỉ được chỉ định
   vào cổng mà sự kiện của vé có mở. assigned_gate_id NULL thì SQL Server
   bỏ qua khóa ngoại ghép này.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.ticket', N'U') IS NULL
CREATE TABLE dbo.ticket (
    ticket_id         NVARCHAR(20) NOT NULL,
    event_id          NVARCHAR(20) NOT NULL,
    assigned_gate_id  NVARCHAR(20) NULL,
    ticket_status     NVARCHAR(20) NOT NULL
        CONSTRAINT DF_ticket_status DEFAULT (N'UNUSED'),

    CONSTRAINT PK_ticket PRIMARY KEY (ticket_id),
    CONSTRAINT FK_ticket_event FOREIGN KEY (event_id) REFERENCES dbo.[event] (event_id),
    CONSTRAINT FK_ticket_event_gate FOREIGN KEY (event_id, assigned_gate_id)
        REFERENCES dbo.event_gate (event_id, gate_id),
    CONSTRAINT CK_ticket_status CHECK (ticket_status COLLATE Latin1_General_100_BIN2 IN
        (N'UNUSED', N'VALID_ENTRY', N'FLAGGED_FRAUD', N'EXPIRED', N'CANCELLED'))
);
GO

/* ---------------------------------------------------------------------
   8. SCAN_EVENT  (tầng Silver, chỉ thêm, không sửa, không xóa)
   Spark KHÔNG ghi bốn cột tính toán ở cuối bảng.
   ticket_id chỉ chứa mã vé đã khớp với bảng ticket; QR hỏng hoặc mã vé
   không có trong DB thì để NULL (mã gốc nằm trong raw_qr_payload và Bronze).
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.scan_event', N'U') IS NULL
CREATE TABLE dbo.scan_event (
    -- Khóa và khóa ngoại
    scan_event_id                UNIQUEIDENTIFIER NOT NULL,
    ticket_id                    NVARCHAR(20)     NULL,
    scanner_id                   NVARCHAR(20)     NOT NULL,
    gate_id                      NVARCHAR(20)     NOT NULL,
    operator_id                  NVARCHAR(20)     NULL,
    previous_scan_event_id       UNIQUEIDENTIFIER NULL,

    -- Dữ liệu gốc từ máy quét và API
    raw_qr_payload               NVARCHAR(512)    NOT NULL,
    decode_error                 BIT              NOT NULL,
    scanned_at                   DATETIME2(3)     NOT NULL,   -- giờ máy quét, chỉ để xem
    received_at                  DATETIME2(3)     NOT NULL,   -- giờ API nhận, mốc chuẩn

    -- Kết quả xử lý của Spark
    processing_ts                DATETIME2(3)     NOT NULL,
    ticket_status_before         NVARCHAR(20)     NULL,
    ticket_status_after          NVARCHAR(20)     NULL,
    scan_result                  NVARCHAR(20)     NOT NULL,
    alert_level                  NVARCHAR(20)     NOT NULL,
    alert_code                   NVARCHAR(20)     NULL,
    previous_scan_gate_id        NVARCHAR(20)     NULL,       -- ảnh chụp, không đặt khóa ngoại
    time_since_previous_scan_ms  INT              NULL,
    min_travel_time_ms           INT              NULL,       -- ảnh chụp từ gate_travel_time
    ticket_assigned_gate_id      NVARCHAR(20)     NULL,       -- ảnh chụp từ ticket
    distinct_wrong_gate_count    INT              NULL,

    -- Cột tính toán (SQL Server tự tính)
    is_wrong_gate    AS CAST(CASE WHEN scan_result = N'WRONG_GATE' THEN 1 ELSE 0 END AS BIT) PERSISTED,
    is_duplicate     AS CAST(CASE WHEN scan_result = N'USED'       THEN 1 ELSE 0 END AS BIT) PERSISTED,
    fraud_alert      AS CAST(CASE WHEN alert_level = N'FRAUD'      THEN 1 ELSE 0 END AS BIT) PERSISTED,
    ingestion_lag_ms AS DATEDIFF(MILLISECOND, received_at, processing_ts) PERSISTED,

    -- Khóa
    CONSTRAINT PK_scan_event PRIMARY KEY (scan_event_id),
    CONSTRAINT FK_scan_event_ticket   FOREIGN KEY (ticket_id)   REFERENCES dbo.ticket (ticket_id),
    CONSTRAINT FK_scan_event_gate     FOREIGN KEY (gate_id)     REFERENCES dbo.gate (gate_id),
    CONSTRAINT FK_scan_event_scanner  FOREIGN KEY (scanner_id, gate_id)
        REFERENCES dbo.scanner (scanner_id, gate_id),
    CONSTRAINT FK_scan_event_user     FOREIGN KEY (operator_id) REFERENCES dbo.app_user (user_id),
    CONSTRAINT FK_scan_event_previous FOREIGN KEY (previous_scan_event_id)
        REFERENCES dbo.scan_event (scan_event_id),

    -- Miền giá trị
    CONSTRAINT CK_scan_event_result CHECK (scan_result COLLATE Latin1_General_100_BIN2 IN
        (N'VALID', N'INVALID', N'USED', N'CANCELLED', N'EXPIRED', N'WRONG_GATE')),
    CONSTRAINT CK_scan_event_level CHECK (alert_level COLLATE Latin1_General_100_BIN2 IN
        (N'NONE', N'WARNING', N'FRAUD')),
    CONSTRAINT CK_scan_event_code CHECK (alert_code IS NULL OR alert_code COLLATE Latin1_General_100_BIN2 IN
        (N'INVALID_QR', N'DUPLICATE_SCAN', N'IMPOSSIBLE_TRAVEL', N'REVOKED_TICKET',
         N'WRONG_GATE_WARNING', N'WRONG_GATE_FRAUD')),
    CONSTRAINT CK_scan_event_status_before CHECK (ticket_status_before IS NULL OR
        ticket_status_before COLLATE Latin1_General_100_BIN2 IN
        (N'UNUSED', N'VALID_ENTRY', N'FLAGGED_FRAUD', N'EXPIRED', N'CANCELLED')),
    CONSTRAINT CK_scan_event_status_after CHECK (ticket_status_after IS NULL OR
        ticket_status_after COLLATE Latin1_General_100_BIN2 IN
        (N'UNUSED', N'VALID_ENTRY', N'FLAGGED_FRAUD', N'EXPIRED', N'CANCELLED')),
    CONSTRAINT CK_scan_event_nonneg CHECK (
        (time_since_previous_scan_ms IS NULL OR time_since_previous_scan_ms >= 0) AND
        (min_travel_time_ms          IS NULL OR min_travel_time_ms > 0) AND
        (distinct_wrong_gate_count   IS NULL OR distinct_wrong_gate_count >= 0)),

    -- Ràng buộc giữa các cột trong cùng dòng (file 07, 08)
    CONSTRAINT CK_scan_event_ts CHECK (processing_ts >= received_at),
    CONSTRAINT CK_scan_event_prev_self CHECK (previous_scan_event_id IS NULL OR previous_scan_event_id <> scan_event_id),
    CONSTRAINT CK_scan_event_status_pair CHECK (
        (ticket_status_before IS NULL AND ticket_status_after IS NULL) OR
        (ticket_status_before IS NOT NULL AND ticket_status_after IS NOT NULL)),
    CONSTRAINT CK_scan_event_decode CHECK (decode_error = 0 OR ticket_id IS NULL),
    CONSTRAINT CK_scan_event_code_level CHECK (
        (alert_code IS NULL AND alert_level = N'NONE') OR
        (alert_code = N'WRONG_GATE_WARNING' AND alert_level = N'WARNING') OR
        (alert_code IN (N'INVALID_QR', N'DUPLICATE_SCAN', N'IMPOSSIBLE_TRAVEL',
                        N'REVOKED_TICKET', N'WRONG_GATE_FRAUD') AND alert_level = N'FRAUD')),
    CONSTRAINT CK_scan_event_result_code CHECK (
        (scan_result IN (N'VALID', N'EXPIRED') AND alert_code IS NULL) OR
        (scan_result = N'INVALID'    AND alert_code = N'INVALID_QR') OR
        (scan_result = N'CANCELLED'  AND alert_code = N'REVOKED_TICKET') OR
        (scan_result = N'USED'       AND alert_code IN (N'DUPLICATE_SCAN', N'IMPOSSIBLE_TRAVEL')) OR
        (scan_result = N'WRONG_GATE' AND alert_code IN (N'WRONG_GATE_WARNING', N'WRONG_GATE_FRAUD'))),
    CONSTRAINT CK_scan_event_used CHECK (
        scan_result <> N'USED' OR
        (previous_scan_event_id IS NOT NULL AND previous_scan_gate_id IS NOT NULL
         AND time_since_previous_scan_ms IS NOT NULL)),
    CONSTRAINT CK_scan_event_wrong_gate CHECK (
        scan_result <> N'WRONG_GATE' OR
        (ticket_assigned_gate_id IS NOT NULL AND distinct_wrong_gate_count IS NOT NULL))
);
GO

/* ---------------------------------------------------------------------
   9. FRAUD_ALERT  (thực thể yếu, định danh qua liên kết 1:1 GENERATES)
   Spark ghi dòng này cùng giao dịch với dòng scan_event tương ứng.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.fraud_alert', N'U') IS NULL
CREATE TABLE dbo.fraud_alert (
    scan_event_id  UNIQUEIDENTIFIER NOT NULL,
    alert_code     NVARCHAR(20)     NOT NULL,
    alert_level    NVARCHAR(20)     NOT NULL,
    created_at     DATETIME2(3)     NOT NULL
        CONSTRAINT DF_fraud_alert_created_at DEFAULT (DATEADD(HOUR, 7, SYSUTCDATETIME())),   -- giờ Việt Nam, không phụ thuộc múi giờ của container

    CONSTRAINT PK_fraud_alert PRIMARY KEY (scan_event_id),
    CONSTRAINT FK_fraud_alert_scan_event FOREIGN KEY (scan_event_id)
        REFERENCES dbo.scan_event (scan_event_id),
    CONSTRAINT CK_fraud_alert_code CHECK (alert_code COLLATE Latin1_General_100_BIN2 IN
        (N'INVALID_QR', N'DUPLICATE_SCAN', N'IMPOSSIBLE_TRAVEL', N'REVOKED_TICKET',
         N'WRONG_GATE_WARNING', N'WRONG_GATE_FRAUD')),
    CONSTRAINT CK_fraud_alert_code_level CHECK (
        (alert_code = N'WRONG_GATE_WARNING' AND alert_level = N'WARNING') OR
        (alert_code IN (N'INVALID_QR', N'DUPLICATE_SCAN', N'IMPOSSIBLE_TRAVEL',
                        N'REVOKED_TICKET', N'WRONG_GATE_FRAUD') AND alert_level = N'FRAUD'))
);
GO

PRINT N'init.sql: hoàn tất.';
GO
