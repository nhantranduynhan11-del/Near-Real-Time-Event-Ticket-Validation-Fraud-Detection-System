

USE ticket_system;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

DECLARE @event_id     NVARCHAR(20) = N'EV001';
DECLARE @ticket_count INT          = 5000;
DECLARE @scan_target  INT          = 300000;
DECLARE @prefix       NVARCHAR(2)  = N'LT';

DECLARE @start DATETIME2(3), @end DATETIME2(3);
SELECT @start = admission_start, @end = admission_end FROM dbo.[event] WHERE event_id = @event_id;
IF @start IS NULL
    THROW 50010, N'Không có sự kiện này trong bảng event.', 1;
IF @ticket_count < 100 OR @ticket_count > 999999
    THROW 50011, N'@ticket_count phải từ 100 đến 999999.', 1;
IF EXISTS (SELECT 1 FROM dbo.ticket WHERE ticket_id LIKE @prefix + N'%')
    THROW 50012, N'Đã có dữ liệu tải (vé bắt đầu bằng LT). Chạy delete_load_data.sql trước.', 1;

DECLARE @win_ms INT = DATEDIFF(MILLISECOND, @start, @end);

SELECT ROW_NUMBER() OVER (ORDER BY eg.gate_id) - 1 AS gate_idx,
       eg.gate_id,
       (SELECT TOP (1) s.scanner_id FROM dbo.scanner AS s WHERE s.gate_id = eg.gate_id ORDER BY s.scanner_id) AS scanner_id
INTO #gate0
FROM dbo.event_gate AS eg
WHERE eg.event_id = @event_id;

SELECT ROW_NUMBER() OVER (ORDER BY user_id) - 1 AS op_idx, user_id
INTO #ops
FROM dbo.app_user
WHERE role = N'GATE_OPERATOR';

DECLARE @gate_count INT = (SELECT COUNT(*) FROM #gate0);
DECLARE @op_count   INT = (SELECT COUNT(*) FROM #ops);
IF @gate_count < 2
    THROW 50013, N'Sự kiện cần ít nhất 2 cổng.', 1;
IF @op_count < 1
    THROW 50014, N'Chưa có nhân viên GATE_OPERATOR nào trong app_user.', 1;
IF EXISTS (SELECT 1 FROM #gate0 WHERE scanner_id IS NULL)
    THROW 50015, N'Có cổng của sự kiện chưa có máy quét.', 1;

SELECT g.gate_idx, g.gate_id, g.scanner_id, o.user_id AS operator_id
INTO #gate_map
FROM #gate0 AS g
JOIN #ops AS o ON o.op_idx = g.gate_idx % @op_count;

SELECT gate_id_1, gate_id_2, min_travel_time_ms
INTO #travel
FROM dbo.gate_travel_time;

;WITH n AS (
    SELECT TOP (@ticket_count) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS k
    FROM sys.all_objects AS a CROSS JOIN sys.all_objects AS b
)
SELECT k,
       @prefix + RIGHT(N'000000' + CAST(k AS NVARCHAR(10)), 6) AS ticket_id,
       CASE WHEN k % 100 < 3 THEN N'C' WHEN k % 100 < 15 THEN N'W' ELSE N'E' END AS grp
INTO #tk
FROM n;

DECLARE @e_count INT = (SELECT COUNT(*) FROM #tk WHERE grp = N'E');
DECLARE @c_count INT = (SELECT COUNT(*) FROM #tk WHERE grp = N'C');
DECLARE @e_avg INT = ISNULL(CAST(CEILING(@scan_target * 0.85 / NULLIF(@e_count, 0)) AS INT), 1);
DECLARE @c_avg INT = ISNULL(CAST(CEILING(@scan_target * 0.03 / NULLIF(@c_count, 0)) AS INT), 1);
IF @e_avg < 1 SET @e_avg = 1;
IF @c_avg < 1 SET @c_avg = 1;

SELECT t.k, t.ticket_id, t.grp,
       CASE WHEN t.grp = N'W' OR t.k % 10 < 7 THEN g.gate_id END AS assigned_gate_id,
       CASE WHEN t.grp = N'W' OR t.k % 10 < 7 THEN g.gate_idx END AS assigned_idx,
       CASE t.grp
            WHEN N'E' THEN 1 + ((CHECKSUM(NEWID()) & 2147483647) % (2 * @e_avg - 1))
            WHEN N'C' THEN 1 + ((CHECKSUM(NEWID()) & 2147483647) % (2 * @c_avg - 1))
            ELSE           1 + ((CHECKSUM(NEWID()) & 2147483647) % (@gate_count - 1))
       END AS m
INTO #tk2
FROM #tk AS t
JOIN #gate_map AS g ON g.gate_idx = t.k % @gate_count;

DECLARE @max_m INT = (SELECT MAX(m) FROM #tk2);

SELECT TOP (@max_m) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
INTO #nums
FROM sys.all_objects AS a CROSS JOIN sys.all_objects AS b;

CREATE TABLE #sc (
    scan_event_id   UNIQUEIDENTIFIER NOT NULL,
    ticket_id       NVARCHAR(20)  COLLATE DATABASE_DEFAULT NULL,
    gate_id         NVARCHAR(20)  COLLATE DATABASE_DEFAULT NOT NULL,
    received_at     DATETIME2(3)  NOT NULL,
    decode_error    BIT           NOT NULL,
    raw_qr_payload  NVARCHAR(512) COLLATE DATABASE_DEFAULT NOT NULL,
    scan_result     NVARCHAR(20)  COLLATE DATABASE_DEFAULT NOT NULL,
    alert_level     NVARCHAR(20)  COLLATE DATABASE_DEFAULT NOT NULL,
    alert_code      NVARCHAR(20)  COLLATE DATABASE_DEFAULT NULL,
    status_before   NVARCHAR(20)  COLLATE DATABASE_DEFAULT NULL,
    status_after    NVARCHAR(20)  COLLATE DATABASE_DEFAULT NULL,
    prev_id         UNIQUEIDENTIFIER NULL,
    prev_gate       NVARCHAR(20)  COLLATE DATABASE_DEFAULT NULL,
    since_ms        INT           NULL,
    min_travel_ms   INT           NULL,
    assigned_gate   NVARCHAR(20)  COLLATE DATABASE_DEFAULT NULL,
    distinct_wrong  INT           NULL
);

SELECT t.ticket_id, t.assigned_gate_id, t.assigned_idx, nums.n AS j,
       NEWID() AS scan_event_id,
       DATEADD(MILLISECOND, (CHECKSUM(NEWID()) & 2147483647) % @win_ms, @start) AS received_at,
       (CHECKSUM(NEWID()) & 2147483647) % @gate_count AS rand_gate_idx,
       LEFT(REPLACE(CONVERT(NVARCHAR(36), NEWID()), N'-', N''), 22) AS sig
INTO #e0
FROM #tk2 AS t
JOIN #nums AS nums ON nums.n <= t.m
WHERE t.grp = N'E';

SELECT *, ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY received_at, j) AS rn
INTO #e1
FROM #e0;

SELECT e.scan_event_id, e.ticket_id, e.assigned_gate_id, e.received_at, e.sig, e.rn, gm.gate_id
INTO #e2
FROM #e1 AS e
JOIN #gate_map AS gm
  ON gm.gate_idx = CASE WHEN e.rn = 1 AND e.assigned_idx IS NOT NULL THEN e.assigned_idx ELSE e.rand_gate_idx END;

INSERT INTO #sc
    (scan_event_id, ticket_id, gate_id, received_at, decode_error, raw_qr_payload, scan_result, alert_level,
     alert_code, status_before, status_after, prev_id, prev_gate, since_ms, min_travel_ms, assigned_gate, distinct_wrong)
SELECT e.scan_event_id,
       e.ticket_id,
       e.gate_id,
       e.received_at,
       0,
       e.ticket_id + N'.' + e.sig,
       CASE WHEN e.rn = 1 THEN N'VALID' ELSE N'USED' END,
       CASE WHEN e.rn = 1 THEN N'NONE'  ELSE N'FRAUD' END,
       CASE WHEN e.rn = 1 THEN NULL
            WHEN tr.min_travel_time_ms IS NOT NULL
                 AND DATEDIFF(MILLISECOND, v.received_at, e.received_at) < tr.min_travel_time_ms
                 THEN N'IMPOSSIBLE_TRAVEL'
            ELSE N'DUPLICATE_SCAN' END,
       CASE e.rn WHEN 1 THEN N'UNUSED' WHEN 2 THEN N'VALID_ENTRY' ELSE N'FLAGGED_FRAUD' END,
       CASE e.rn WHEN 1 THEN N'VALID_ENTRY' ELSE N'FLAGGED_FRAUD' END,
       CASE WHEN e.rn = 1 THEN NULL ELSE v.scan_event_id END,
       CASE WHEN e.rn = 1 THEN NULL ELSE v.gate_id END,
       CASE WHEN e.rn = 1 THEN NULL ELSE DATEDIFF(MILLISECOND, v.received_at, e.received_at) END,
       CASE WHEN e.rn = 1 THEN NULL ELSE tr.min_travel_time_ms END,
       e.assigned_gate_id,
       NULL
FROM #e2 AS e
LEFT JOIN #e2 AS v ON v.ticket_id = e.ticket_id AND v.rn = 1
LEFT JOIN #travel AS tr ON tr.gate_id_1 = v.gate_id AND tr.gate_id_2 = e.gate_id;

SELECT t.ticket_id, t.assigned_gate_id,
       NEWID() AS scan_event_id,
       DATEADD(MILLISECOND, (CHECKSUM(NEWID()) & 2147483647) % @win_ms, @start) AS received_at,
       (CHECKSUM(NEWID()) & 2147483647) % @gate_count AS rand_gate_idx,
       LEFT(REPLACE(CONVERT(NVARCHAR(36), NEWID()), N'-', N''), 22) AS sig
INTO #c0
FROM #tk2 AS t
JOIN #nums AS nums ON nums.n <= t.m
WHERE t.grp = N'C';

INSERT INTO #sc
    (scan_event_id, ticket_id, gate_id, received_at, decode_error, raw_qr_payload, scan_result, alert_level,
     alert_code, status_before, status_after, prev_id, prev_gate, since_ms, min_travel_ms, assigned_gate, distinct_wrong)
SELECT c.scan_event_id, c.ticket_id, gm.gate_id, c.received_at, 0, c.ticket_id + N'.' + c.sig,
       N'CANCELLED', N'FRAUD', N'REVOKED_TICKET', N'CANCELLED', N'CANCELLED',
       NULL, NULL, NULL, NULL, c.assigned_gate_id, NULL
FROM #c0 AS c
JOIN #gate_map AS gm ON gm.gate_idx = c.rand_gate_idx;

SELECT t.ticket_id, t.assigned_gate_id, t.assigned_idx, nums.n AS j,
       NEWID() AS scan_event_id,
       DATEADD(MILLISECOND, (CHECKSUM(NEWID()) & 2147483647) % @win_ms, @start) AS received_at,
       LEFT(REPLACE(CONVERT(NVARCHAR(36), NEWID()), N'-', N''), 22) AS sig
INTO #w0
FROM #tk2 AS t
JOIN #nums AS nums ON nums.n <= t.m
WHERE t.grp = N'W';

SELECT *, ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY received_at, j) AS rn
INTO #w1
FROM #w0;

INSERT INTO #sc
    (scan_event_id, ticket_id, gate_id, received_at, decode_error, raw_qr_payload, scan_result, alert_level,
     alert_code, status_before, status_after, prev_id, prev_gate, since_ms, min_travel_ms, assigned_gate, distinct_wrong)
SELECT w.scan_event_id, w.ticket_id, gm.gate_id, w.received_at, 0, w.ticket_id + N'.' + w.sig,
       N'WRONG_GATE',
       CASE WHEN w.rn >= @gate_count - 1 THEN N'FRAUD' ELSE N'WARNING' END,
       CASE WHEN w.rn >= @gate_count - 1 THEN N'WRONG_GATE_FRAUD' ELSE N'WRONG_GATE_WARNING' END,
       N'UNUSED', N'UNUSED', NULL, NULL, NULL, NULL, w.assigned_gate_id, CAST(w.rn AS INT)
FROM #w1 AS w
JOIN #gate_map AS gm ON gm.gate_idx = (w.assigned_idx + w.rn) % @gate_count;

DECLARE @made INT = (SELECT COUNT(*) FROM #sc);
DECLARE @invalid_n INT = @scan_target - @made;

IF @invalid_n > 0
BEGIN
    SELECT TOP (@invalid_n)
           NEWID() AS scan_event_id,
           (CHECKSUM(NEWID()) & 2147483647) % @gate_count AS gate_idx,
           DATEADD(MILLISECOND, (CHECKSUM(NEWID()) & 2147483647) % @win_ms, @start) AS received_at,
           (CHECKSUM(NEWID()) & 2147483647) % 2 AS bad_sig,
           REPLACE(CONVERT(NVARCHAR(36), NEWID()), N'-', N'') AS junk
    INTO #inv0
    FROM sys.all_objects AS a CROSS JOIN sys.all_objects AS b;

    INSERT INTO #sc
        (scan_event_id, ticket_id, gate_id, received_at, decode_error, raw_qr_payload, scan_result, alert_level,
         alert_code, status_before, status_after, prev_id, prev_gate, since_ms, min_travel_ms, assigned_gate, distinct_wrong)
    SELECT i.scan_event_id, NULL, gm.gate_id, i.received_at, CAST(i.bad_sig AS BIT),
           N'LOAD:' + CASE WHEN i.bad_sig = 1 THEN N'BADSIG:' ELSE N'UNKNOWN:' END + i.junk,
           N'INVALID', N'FRAUD', N'INVALID_QR', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM #inv0 AS i
    JOIN #gate_map AS gm ON gm.gate_idx = i.gate_idx;
END

BEGIN TRANSACTION;

INSERT INTO dbo.ticket (ticket_id, event_id, assigned_gate_id, ticket_status)
SELECT t.ticket_id,
       @event_id,
       t.assigned_gate_id,
       CASE t.grp
            WHEN N'C' THEN N'CANCELLED'
            WHEN N'W' THEN N'UNUSED'
            ELSE CASE WHEN t.m >= 2 THEN N'FLAGGED_FRAUD' ELSE N'VALID_ENTRY' END
       END
FROM #tk2 AS t;

INSERT INTO dbo.scan_event
    (scan_event_id, event_id, ticket_id, scanner_id, gate_id, operator_id, previous_scan_event_id,
     raw_qr_payload, decode_error, scanned_at, received_at, processing_ts,
     ticket_status_before, ticket_status_after, scan_result, alert_level, alert_code,
     previous_scan_gate_id, time_since_previous_scan_ms, min_travel_time_ms,
     ticket_assigned_gate_id, distinct_wrong_gate_count)
SELECT s.scan_event_id, @event_id, s.ticket_id, gm.scanner_id, s.gate_id, gm.operator_id, s.prev_id,
       s.raw_qr_payload, s.decode_error,
       DATEADD(MILLISECOND, -((CHECKSUM(NEWID()) & 2147483647) % 300), s.received_at),
       s.received_at,
       DATEADD(MILLISECOND, 50 + ((CHECKSUM(NEWID()) & 2147483647) % 1450), s.received_at),
       s.status_before, s.status_after, s.scan_result, s.alert_level, s.alert_code,
       s.prev_gate, s.since_ms, s.min_travel_ms, s.assigned_gate, s.distinct_wrong
FROM #sc AS s
JOIN #gate_map AS gm ON gm.gate_id = s.gate_id;

INSERT INTO dbo.fraud_alert (scan_event_id, alert_code, alert_level, created_at)
SELECT s.scan_event_id, s.alert_code, s.alert_level, s.processing_ts
FROM dbo.scan_event AS s
WHERE s.event_id = @event_id
  AND s.alert_level <> N'NONE'
  AND (s.ticket_id LIKE @prefix + N'%' OR s.raw_qr_payload LIKE N'LOAD:%');

COMMIT TRANSACTION;

EXEC dbo.usp_refresh_gold @event_id = @event_id;

SELECT N've tai' AS bang, COUNT(*) AS so_dong FROM dbo.ticket WHERE ticket_id LIKE @prefix + N'%'
UNION ALL
SELECT N'scan_event tai', COUNT(*) FROM dbo.scan_event
WHERE ticket_id LIKE @prefix + N'%' OR raw_qr_payload LIKE N'LOAD:%'
UNION ALL
SELECT N'fraud_alert tai', COUNT(*) FROM dbo.fraud_alert AS f
JOIN dbo.scan_event AS s ON s.scan_event_id = f.scan_event_id
WHERE s.ticket_id LIKE @prefix + N'%' OR s.raw_qr_payload LIKE N'LOAD:%'
UNION ALL
SELECT N'scan_event ngoai khung gio (phai la 0)', COUNT(*) FROM dbo.scan_event
WHERE (ticket_id LIKE @prefix + N'%' OR raw_qr_payload LIKE N'LOAD:%')
  AND (received_at < @start OR received_at >= @end);

SELECT scan_result, COUNT(*) AS so_dong
FROM dbo.scan_event
WHERE ticket_id LIKE @prefix + N'%' OR raw_qr_payload LIKE N'LOAD:%'
GROUP BY scan_result
ORDER BY scan_result;

SELECT DATEPART(HOUR, received_at) AS gio, (DATEPART(MINUTE, received_at) / 15) * 15 AS phut_dau_khung,
       COUNT(*) AS so_dong
FROM dbo.scan_event
WHERE ticket_id LIKE @prefix + N'%' OR raw_qr_payload LIKE N'LOAD:%'
GROUP BY DATEPART(HOUR, received_at), (DATEPART(MINUTE, received_at) / 15) * 15
ORDER BY gio, phut_dau_khung;
GO
