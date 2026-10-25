IF DB_ID(N'ticket_system') IS NULL
    CREATE DATABASE ticket_system COLLATE Vietnamese_CI_AS;
GO

USE ticket_system;
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID(N'dbo.[event]', N'U') IS NULL
CREATE TABLE dbo.[event] (
    event_id         NVARCHAR(20)  NOT NULL,
    event_name       NVARCHAR(200) NOT NULL,
    admission_start  DATETIME2(3)  NOT NULL,
    admission_end    DATETIME2(3)  NOT NULL,

    CONSTRAINT PK_event PRIMARY KEY (event_id),
    CONSTRAINT CK_event_window CHECK (admission_end > admission_start)
);
GO

IF OBJECT_ID(N'dbo.gate', N'U') IS NULL
CREATE TABLE dbo.gate (
    gate_id    NVARCHAR(20)  NOT NULL,
    gate_name  NVARCHAR(100) NOT NULL,

    CONSTRAINT PK_gate PRIMARY KEY (gate_id)
);
GO

IF OBJECT_ID(N'dbo.event_gate', N'U') IS NULL
CREATE TABLE dbo.event_gate (
    event_id  NVARCHAR(20) NOT NULL,
    gate_id   NVARCHAR(20) NOT NULL,

    CONSTRAINT PK_event_gate PRIMARY KEY (event_id, gate_id),
    CONSTRAINT FK_event_gate_event FOREIGN KEY (event_id) REFERENCES dbo.[event] (event_id),
    CONSTRAINT FK_event_gate_gate  FOREIGN KEY (gate_id)  REFERENCES dbo.gate (gate_id)
);
GO

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

IF OBJECT_ID(N'dbo.scanner', N'U') IS NULL
CREATE TABLE dbo.scanner (
    scanner_id  NVARCHAR(20) NOT NULL,
    gate_id     NVARCHAR(20) NOT NULL,

    CONSTRAINT PK_scanner PRIMARY KEY (scanner_id),
    CONSTRAINT FK_scanner_gate FOREIGN KEY (gate_id) REFERENCES dbo.gate (gate_id),
    CONSTRAINT UQ_scanner_scanner_gate UNIQUE (scanner_id, gate_id)
);
GO

IF OBJECT_ID(N'dbo.app_user', N'U') IS NULL
CREATE TABLE dbo.app_user (
    user_id        NVARCHAR(20)  NOT NULL,
    username       NVARCHAR(50)  NOT NULL,
    password_hash  NVARCHAR(255) NOT NULL,
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

IF OBJECT_ID(N'dbo.scan_event', N'U') IS NULL
CREATE TABLE dbo.scan_event (

    scan_event_id                UNIQUEIDENTIFIER NOT NULL,
    ticket_id                    NVARCHAR(20)     NULL,
    scanner_id                   NVARCHAR(20)     NOT NULL,
    gate_id                      NVARCHAR(20)     NOT NULL,
    operator_id                  NVARCHAR(20)     NULL,
    previous_scan_event_id       UNIQUEIDENTIFIER NULL,

    raw_qr_payload               NVARCHAR(512)    NOT NULL,
    decode_error                 BIT              NOT NULL,
    scanned_at                   DATETIME2(3)     NOT NULL,
    received_at                  DATETIME2(3)     NOT NULL,

    processing_ts                DATETIME2(3)     NOT NULL,
    ticket_status_before         NVARCHAR(20)     NULL,
    ticket_status_after          NVARCHAR(20)     NULL,
    scan_result                  NVARCHAR(20)     NOT NULL,
    alert_level                  NVARCHAR(20)     NOT NULL,
    alert_code                   NVARCHAR(20)     NULL,
    previous_scan_gate_id        NVARCHAR(20)     NULL,
    time_since_previous_scan_ms  INT              NULL,
    min_travel_time_ms           INT              NULL,
    ticket_assigned_gate_id      NVARCHAR(20)     NULL,
    distinct_wrong_gate_count    INT              NULL,

    is_wrong_gate    AS CAST(CASE WHEN scan_result = N'WRONG_GATE' THEN 1 ELSE 0 END AS BIT) PERSISTED,
    is_duplicate     AS CAST(CASE WHEN scan_result = N'USED'       THEN 1 ELSE 0 END AS BIT) PERSISTED,
    fraud_alert      AS CAST(CASE WHEN alert_level = N'FRAUD'      THEN 1 ELSE 0 END AS BIT) PERSISTED,
    ingestion_lag_ms AS DATEDIFF(MILLISECOND, received_at, processing_ts) PERSISTED,

    CONSTRAINT PK_scan_event PRIMARY KEY (scan_event_id),
    CONSTRAINT FK_scan_event_ticket   FOREIGN KEY (ticket_id)   REFERENCES dbo.ticket (ticket_id),
    CONSTRAINT FK_scan_event_gate     FOREIGN KEY (gate_id)     REFERENCES dbo.gate (gate_id),
    CONSTRAINT FK_scan_event_scanner  FOREIGN KEY (scanner_id, gate_id)
        REFERENCES dbo.scanner (scanner_id, gate_id),
    CONSTRAINT FK_scan_event_user     FOREIGN KEY (operator_id) REFERENCES dbo.app_user (user_id),
    CONSTRAINT FK_scan_event_previous FOREIGN KEY (previous_scan_event_id)
        REFERENCES dbo.scan_event (scan_event_id),

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

IF OBJECT_ID(N'dbo.fraud_alert', N'U') IS NULL
CREATE TABLE dbo.fraud_alert (
    scan_event_id  UNIQUEIDENTIFIER NOT NULL,
    alert_code     NVARCHAR(20)     NOT NULL,
    alert_level    NVARCHAR(20)     NOT NULL,
    created_at     DATETIME2(3)     NOT NULL
        CONSTRAINT DF_fraud_alert_created_at DEFAULT (DATEADD(HOUR, 7, SYSUTCDATETIME())),

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

IF OBJECT_ID(N'dbo.gold_gate_stats', N'U') IS NULL
CREATE TABLE dbo.gold_gate_stats (
    event_id        NVARCHAR(20)  NOT NULL,
    gate_id         NVARCHAR(20)  NOT NULL,
    total_scans     INT           NOT NULL CONSTRAINT DF_gold_gate_stats_total     DEFAULT (0),
    cnt_valid       INT           NOT NULL CONSTRAINT DF_gold_gate_stats_valid     DEFAULT (0),
    cnt_invalid     INT           NOT NULL CONSTRAINT DF_gold_gate_stats_invalid   DEFAULT (0),
    cnt_used        INT           NOT NULL CONSTRAINT DF_gold_gate_stats_used      DEFAULT (0),
    cnt_cancelled   INT           NOT NULL CONSTRAINT DF_gold_gate_stats_cancelled DEFAULT (0),
    cnt_expired     INT           NOT NULL CONSTRAINT DF_gold_gate_stats_expired   DEFAULT (0),
    cnt_wrong_gate  INT           NOT NULL CONSTRAINT DF_gold_gate_stats_wrong     DEFAULT (0),
    fraud_count     INT           NOT NULL CONSTRAINT DF_gold_gate_stats_fraud     DEFAULT (0),
    warning_count   INT           NOT NULL CONSTRAINT DF_gold_gate_stats_warning   DEFAULT (0),
    last_scan_at    DATETIME2(3)  NULL,
    updated_at      DATETIME2(3)  NOT NULL CONSTRAINT DF_gold_gate_stats_updated_at
        DEFAULT (DATEADD(HOUR, 7, SYSUTCDATETIME())),

    CONSTRAINT PK_gold_gate_stats PRIMARY KEY (event_id, gate_id),
    CONSTRAINT FK_gold_gate_stats_event FOREIGN KEY (event_id) REFERENCES dbo.[event] (event_id),
    CONSTRAINT FK_gold_gate_stats_gate  FOREIGN KEY (gate_id)  REFERENCES dbo.gate (gate_id),
    CONSTRAINT CK_gold_gate_stats_nonneg CHECK (
        total_scans >= 0 AND cnt_valid >= 0 AND cnt_invalid >= 0 AND cnt_used >= 0 AND
        cnt_cancelled >= 0 AND cnt_expired >= 0 AND cnt_wrong_gate >= 0 AND
        fraud_count >= 0 AND warning_count >= 0)
);
GO

IF OBJECT_ID(N'dbo.gold_event_stats', N'U') IS NULL
CREATE TABLE dbo.gold_event_stats (
    event_id        NVARCHAR(20)  NOT NULL,
    bucket_start    DATETIME2(3)  NOT NULL,
    total_scans     INT           NOT NULL CONSTRAINT DF_gold_event_stats_total     DEFAULT (0),
    cnt_valid       INT           NOT NULL CONSTRAINT DF_gold_event_stats_valid     DEFAULT (0),
    cnt_invalid     INT           NOT NULL CONSTRAINT DF_gold_event_stats_invalid   DEFAULT (0),
    cnt_used        INT           NOT NULL CONSTRAINT DF_gold_event_stats_used      DEFAULT (0),
    cnt_cancelled   INT           NOT NULL CONSTRAINT DF_gold_event_stats_cancelled DEFAULT (0),
    cnt_expired     INT           NOT NULL CONSTRAINT DF_gold_event_stats_expired   DEFAULT (0),
    cnt_wrong_gate  INT           NOT NULL CONSTRAINT DF_gold_event_stats_wrong     DEFAULT (0),
    fraud_count     INT           NOT NULL CONSTRAINT DF_gold_event_stats_fraud     DEFAULT (0),
    warning_count   INT           NOT NULL CONSTRAINT DF_gold_event_stats_warning   DEFAULT (0),
    updated_at      DATETIME2(3)  NOT NULL CONSTRAINT DF_gold_event_stats_updated_at
        DEFAULT (DATEADD(HOUR, 7, SYSUTCDATETIME())),

    CONSTRAINT PK_gold_event_stats PRIMARY KEY (event_id, bucket_start),
    CONSTRAINT FK_gold_event_stats_event FOREIGN KEY (event_id) REFERENCES dbo.[event] (event_id),
    CONSTRAINT CK_gold_event_stats_nonneg CHECK (
        total_scans >= 0 AND cnt_valid >= 0 AND cnt_invalid >= 0 AND cnt_used >= 0 AND
        cnt_cancelled >= 0 AND cnt_expired >= 0 AND cnt_wrong_gate >= 0 AND
        fraud_count >= 0 AND warning_count >= 0)
);
GO

IF OBJECT_ID(N'dbo.gold_alert', N'U') IS NULL
CREATE TABLE dbo.gold_alert (
    scan_event_id                UNIQUEIDENTIFIER NOT NULL,
    event_id                     NVARCHAR(20)     NOT NULL,
    created_at                   DATETIME2(3)     NOT NULL,
    received_at                  DATETIME2(3)     NOT NULL,
    alert_level                  NVARCHAR(20)     NOT NULL,
    alert_code                   NVARCHAR(20)     NOT NULL,
    scan_result                  NVARCHAR(20)     NOT NULL,
    ticket_id                    NVARCHAR(20)     NULL,
    gate_id                      NVARCHAR(20)     NOT NULL,
    scanner_id                   NVARCHAR(20)     NOT NULL,
    previous_scan_gate_id        NVARCHAR(20)     NULL,
    time_since_previous_scan_ms  INT              NULL,
    min_travel_time_ms           INT              NULL,
    ticket_assigned_gate_id      NVARCHAR(20)     NULL,
    distinct_wrong_gate_count    INT              NULL,
    raw_qr_preview               NVARCHAR(24)     NULL,

    CONSTRAINT PK_gold_alert PRIMARY KEY (scan_event_id),
    CONSTRAINT FK_gold_alert_scan_event FOREIGN KEY (scan_event_id) REFERENCES dbo.scan_event (scan_event_id),
    CONSTRAINT FK_gold_alert_event FOREIGN KEY (event_id) REFERENCES dbo.[event] (event_id),
    CONSTRAINT CK_gold_alert_level CHECK (alert_level COLLATE Latin1_General_100_BIN2 IN (N'WARNING', N'FRAUD')),
    CONSTRAINT CK_gold_alert_code CHECK (alert_code COLLATE Latin1_General_100_BIN2 IN
        (N'INVALID_QR', N'DUPLICATE_SCAN', N'IMPOSSIBLE_TRAVEL', N'REVOKED_TICKET',
         N'WRONG_GATE_WARNING', N'WRONG_GATE_FRAUD')),
    CONSTRAINT CK_gold_alert_code_level CHECK (
        (alert_code = N'WRONG_GATE_WARNING' AND alert_level = N'WARNING') OR
        (alert_code IN (N'INVALID_QR', N'DUPLICATE_SCAN', N'IMPOSSIBLE_TRAVEL',
                        N'REVOKED_TICKET', N'WRONG_GATE_FRAUD') AND alert_level = N'FRAUD'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_gold_alert_event_created' AND object_id = OBJECT_ID(N'dbo.gold_alert'))
    CREATE INDEX IX_gold_alert_event_created ON dbo.gold_alert (event_id, created_at DESC);
GO

PRINT N'init.sql: hoàn tất.';
GO
