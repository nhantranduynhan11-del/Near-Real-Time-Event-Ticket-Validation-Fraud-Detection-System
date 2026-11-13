
USE ticket_system;
GO

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

DECLARE @fail INT = 0;

PRINT N'Xóa dữ liệu scan/Gold cũ (theo thứ tự reset) trước khi thử...';
DELETE FROM dbo.gold_alert;
DELETE FROM dbo.fraud_alert;
DELETE FROM dbo.scan_event;
DELETE FROM dbo.gold_gate_stats;
DELETE FROM dbo.gold_event_stats;

INSERT INTO dbo.scan_event
    (scan_event_id, event_id, ticket_id, scanner_id, gate_id, operator_id, previous_scan_event_id,
     raw_qr_payload, decode_error, scanned_at, received_at, processing_ts,
     ticket_status_before, ticket_status_after, scan_result, alert_level, alert_code,
     previous_scan_gate_id, time_since_previous_scan_ms, min_travel_time_ms,
     ticket_assigned_gate_id, distinct_wrong_gate_count)
VALUES
 ('A0000000-0000-0000-0000-000000000001', N'EV001', N'TK001', N'SC_A1', N'GATE_A', N'OP_A', NULL,
  N'TK001', 0, '2026-12-12T18:05:09.500', '2026-12-12T18:05:10.000', '2026-12-12T18:05:10.200',
  N'UNUSED', N'VALID_ENTRY', N'VALID', N'NONE', NULL, NULL, NULL, NULL, NULL, NULL),
 ('A0000000-0000-0000-0000-000000000002', N'EV001', N'TK001', N'SC_A1', N'GATE_A', N'OP_A', 'A0000000-0000-0000-0000-000000000001',
  N'TK001', 0, '2026-12-12T18:05:39.500', '2026-12-12T18:05:40.000', '2026-12-12T18:05:40.200',
  N'VALID_ENTRY', N'FLAGGED_FRAUD', N'USED', N'FRAUD', N'DUPLICATE_SCAN', N'GATE_A', 30000, NULL, NULL, NULL),
 ('A0000000-0000-0000-0000-000000000003', N'EV001', N'TK001', N'SC_D1', N'GATE_D', N'OP_D', 'A0000000-0000-0000-0000-000000000002',
  N'TK001', 0, '2026-12-12T18:06:04.500', '2026-12-12T18:06:05.000', '2026-12-12T18:06:05.200',
  N'FLAGGED_FRAUD', N'FLAGGED_FRAUD', N'USED', N'FRAUD', N'IMPOSSIBLE_TRAVEL', N'GATE_A', 25000, 140000, NULL, NULL),
 ('A0000000-0000-0000-0000-000000000004', N'EV001', N'TK002', N'SC_C1', N'GATE_C', N'OP_C', NULL,
  N'TK002', 0, '2026-12-12T18:06:19.500', '2026-12-12T18:06:20.000', '2026-12-12T18:06:20.200',
  N'UNUSED', N'UNUSED', N'WRONG_GATE', N'WARNING', N'WRONG_GATE_WARNING', NULL, NULL, NULL, N'GATE_B', 1),
 ('A0000000-0000-0000-0000-000000000005', N'EV001', N'TK003', N'SC_C1', N'GATE_C', N'OP_C', NULL,
  N'TK003', 0, '2026-12-12T18:06:39.500', '2026-12-12T18:06:40.000', '2026-12-12T18:06:40.200',
  N'CANCELLED', N'CANCELLED', N'CANCELLED', N'FRAUD', N'REVOKED_TICKET', NULL, NULL, NULL, NULL, NULL),
 ('A0000000-0000-0000-0000-000000000006', N'EV001', NULL, N'SC_B1', N'GATE_B', N'OP_B', NULL,
  N'garbage-qr-payload', 1, '2026-12-12T18:06:44.500', '2026-12-12T18:06:45.000', '2026-12-12T18:06:45.200',
  NULL, NULL, N'INVALID', N'FRAUD', N'INVALID_QR', NULL, NULL, NULL, NULL, NULL),
 ('A0000000-0000-0000-0000-000000000007', N'EV001', N'TK004', N'SC_B1', N'GATE_B', N'OP_B', NULL,
  N'TK004', 0, '2026-12-12T20:29:59.500', '2026-12-12T20:30:00.000', '2026-12-12T20:30:00.200',
  N'UNUSED', N'UNUSED', N'EXPIRED', N'NONE', NULL, NULL, NULL, NULL, NULL, NULL),
 ('A0000000-0000-0000-0000-000000000008', N'EV001', N'TK007', N'SC_C1', N'GATE_C', N'OP_C', NULL,
  N'TK007', 0, '2026-12-12T18:06:49.500', '2026-12-12T18:06:50.000', '2026-12-12T18:06:50.200',
  N'UNUSED', N'VALID_ENTRY', N'VALID', N'NONE', NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO dbo.fraud_alert (scan_event_id, alert_code, alert_level, created_at)
VALUES
 ('A0000000-0000-0000-0000-000000000002', N'DUPLICATE_SCAN',     N'FRAUD',   '2026-12-12T18:05:40.300'),
 ('A0000000-0000-0000-0000-000000000003', N'IMPOSSIBLE_TRAVEL',  N'FRAUD',   '2026-12-12T18:06:05.300'),
 ('A0000000-0000-0000-0000-000000000004', N'WRONG_GATE_WARNING', N'WARNING', '2026-12-12T18:06:20.300'),
 ('A0000000-0000-0000-0000-000000000005', N'REVOKED_TICKET',     N'FRAUD',   '2026-12-12T18:06:40.300'),
 ('A0000000-0000-0000-0000-000000000006', N'INVALID_QR',         N'FRAUD',   '2026-12-12T18:06:45.300');

PRINT N'--- Lần gọi 1 ---';
EXEC dbo.usp_refresh_gold @event_id = N'EV001';

IF (SELECT COUNT(*) FROM dbo.gold_gate_stats WHERE event_id = N'EV001') = 4
   AND (SELECT total_scans FROM dbo.gold_gate_stats WHERE event_id = N'EV001' AND gate_id = N'GATE_A') = 2
   AND (SELECT total_scans FROM dbo.gold_gate_stats WHERE event_id = N'EV001' AND gate_id = N'GATE_B') = 2
   AND (SELECT total_scans FROM dbo.gold_gate_stats WHERE event_id = N'EV001' AND gate_id = N'GATE_C') = 3
   AND (SELECT total_scans FROM dbo.gold_gate_stats WHERE event_id = N'EV001' AND gate_id = N'GATE_D') = 1
    PRINT N'PASS: gold_gate_stats có 4 cổng, số lượt quét A=2 B=2 C=3 D=1';
ELSE BEGIN PRINT N'FAIL: gold_gate_stats sai số cổng hoặc số lượt quét'; SET @fail += 1; END

IF (SELECT SUM(total_scans) FROM dbo.gold_gate_stats) = 8
   AND (SELECT SUM(cnt_valid)      FROM dbo.gold_gate_stats) = 2
   AND (SELECT SUM(cnt_invalid)    FROM dbo.gold_gate_stats) = 1
   AND (SELECT SUM(cnt_used)       FROM dbo.gold_gate_stats) = 2
   AND (SELECT SUM(cnt_cancelled)  FROM dbo.gold_gate_stats) = 1
   AND (SELECT SUM(cnt_expired)    FROM dbo.gold_gate_stats) = 1
   AND (SELECT SUM(cnt_wrong_gate) FROM dbo.gold_gate_stats) = 1
   AND (SELECT SUM(fraud_count)    FROM dbo.gold_gate_stats) = 4
   AND (SELECT SUM(warning_count)  FROM dbo.gold_gate_stats) = 1
    PRINT N'PASS: tổng theo từng loại kết quả, fraud_count=4 (không gồm WARNING), warning_count=1';
ELSE BEGIN PRINT N'FAIL: tổng theo loại kết quả hoặc fraud/warning sai'; SET @fail += 1; END

IF (SELECT COUNT(*) FROM dbo.gold_event_stats WHERE event_id = N'EV001') = 3
   AND (SELECT total_scans FROM dbo.gold_event_stats WHERE event_id = N'EV001' AND bucket_start = '2026-12-12T18:05:00') = 2
   AND (SELECT total_scans FROM dbo.gold_event_stats WHERE event_id = N'EV001' AND bucket_start = '2026-12-12T18:06:00') = 5
   AND (SELECT total_scans FROM dbo.gold_event_stats WHERE event_id = N'EV001' AND bucket_start = '2026-12-12T20:30:00') = 1
    PRINT N'PASS: gold_event_stats có đúng 3 bucket (18:05=2, 18:06=5, 20:30=1), không có dòng cho phút trống';
ELSE BEGIN PRINT N'FAIL: gold_event_stats sai bucket'; SET @fail += 1; END

IF (SELECT SUM(total_scans) FROM dbo.gold_event_stats) = (SELECT SUM(total_scans) FROM dbo.gold_gate_stats)
   AND (SELECT SUM(fraud_count) FROM dbo.gold_event_stats) = (SELECT SUM(fraud_count) FROM dbo.gold_gate_stats)
    PRINT N'PASS: tổng theo cổng và tổng theo phút khớp nhau';
ELSE BEGIN PRINT N'FAIL: tổng theo cổng khác tổng theo phút'; SET @fail += 1; END

IF (SELECT COUNT(*) FROM dbo.gold_alert) = 5
   AND (SELECT COUNT(*) FROM dbo.gold_alert WHERE alert_level = N'FRAUD') = 4
   AND (SELECT COUNT(*) FROM dbo.gold_alert WHERE alert_level = N'WARNING') = 1
    PRINT N'PASS: gold_alert có 5 cảnh báo (4 FRAUD, 1 WARNING), không có dòng cho VALID/EXPIRED';
ELSE BEGIN PRINT N'FAIL: gold_alert sai số dòng'; SET @fail += 1; END

IF (SELECT created_at FROM dbo.gold_alert WHERE scan_event_id = 'A0000000-0000-0000-0000-000000000002') = '2026-12-12T18:05:40.300'
    PRINT N'PASS: created_at lấy từ fraud_alert';
ELSE BEGIN PRINT N'FAIL: created_at không lấy từ fraud_alert'; SET @fail += 1; END

IF (SELECT raw_qr_preview FROM dbo.gold_alert WHERE scan_event_id = 'A0000000-0000-0000-0000-000000000006') = N'garbage-qr-payload'
   AND NOT EXISTS (SELECT 1 FROM dbo.gold_alert WHERE ticket_id IS NOT NULL AND raw_qr_preview IS NOT NULL)
    PRINT N'PASS: raw_qr_preview chỉ có khi ticket_id NULL';
ELSE BEGIN PRINT N'FAIL: raw_qr_preview sai'; SET @fail += 1; END

SELECT event_id, gate_id, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled, cnt_expired,
       cnt_wrong_gate, fraud_count, warning_count, last_scan_at
INTO #g1 FROM dbo.gold_gate_stats;
SELECT event_id, bucket_start, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled, cnt_expired,
       cnt_wrong_gate, fraud_count, warning_count
INTO #e1 FROM dbo.gold_event_stats;
SELECT scan_event_id, event_id, created_at, received_at, alert_level, alert_code, scan_result, ticket_id,
       gate_id, scanner_id, previous_scan_gate_id, time_since_previous_scan_ms, min_travel_time_ms,
       ticket_assigned_gate_id, distinct_wrong_gate_count, raw_qr_preview
INTO #a1 FROM dbo.gold_alert;

PRINT N'--- Lần gọi 2 liên tiếp (không đổi dữ liệu Silver) ---';
EXEC dbo.usp_refresh_gold @event_id = N'EV001';

IF NOT EXISTS (SELECT * FROM (SELECT * FROM #g1 EXCEPT SELECT event_id, gate_id, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled, cnt_expired, cnt_wrong_gate, fraud_count, warning_count, last_scan_at FROM dbo.gold_gate_stats) d)
   AND NOT EXISTS (SELECT * FROM (SELECT event_id, gate_id, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled, cnt_expired, cnt_wrong_gate, fraud_count, warning_count, last_scan_at FROM dbo.gold_gate_stats EXCEPT SELECT * FROM #g1) d)
   AND NOT EXISTS (SELECT * FROM (SELECT * FROM #e1 EXCEPT SELECT event_id, bucket_start, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled, cnt_expired, cnt_wrong_gate, fraud_count, warning_count FROM dbo.gold_event_stats) d)
   AND NOT EXISTS (SELECT * FROM (SELECT event_id, bucket_start, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled, cnt_expired, cnt_wrong_gate, fraud_count, warning_count FROM dbo.gold_event_stats EXCEPT SELECT * FROM #e1) d)
   AND NOT EXISTS (SELECT * FROM (SELECT * FROM #a1 EXCEPT SELECT scan_event_id, event_id, created_at, received_at, alert_level, alert_code, scan_result, ticket_id, gate_id, scanner_id, previous_scan_gate_id, time_since_previous_scan_ms, min_travel_time_ms, ticket_assigned_gate_id, distinct_wrong_gate_count, raw_qr_preview FROM dbo.gold_alert) d)
   AND (SELECT COUNT(*) FROM dbo.gold_alert) = (SELECT COUNT(*) FROM #a1)
    PRINT N'PASS: gọi lần 2 cho kết quả y hệt lần 1 ở cả 3 bảng Gold';
ELSE BEGIN PRINT N'FAIL: gọi lần 2 ra kết quả khác lần 1'; SET @fail += 1; END

UPDATE dbo.gold_alert SET raw_qr_preview = N'MARKER' WHERE scan_event_id = 'A0000000-0000-0000-0000-000000000006';
EXEC dbo.usp_refresh_gold @event_id = N'EV001';
IF (SELECT raw_qr_preview FROM dbo.gold_alert WHERE scan_event_id = 'A0000000-0000-0000-0000-000000000006') = N'MARKER'
   AND (SELECT COUNT(*) FROM dbo.gold_alert) = 5
    PRINT N'PASS: gold_alert không bị ghi đè, không bị nhân đôi';
ELSE BEGIN PRINT N'FAIL: gold_alert bị ghi đè hoặc nhân đôi'; SET @fail += 1; END

PRINT N'--- Thêm 2 lượt quét mới vào Silver rồi gọi lại ---';
INSERT INTO dbo.scan_event
    (scan_event_id, event_id, ticket_id, scanner_id, gate_id, operator_id, previous_scan_event_id,
     raw_qr_payload, decode_error, scanned_at, received_at, processing_ts,
     ticket_status_before, ticket_status_after, scan_result, alert_level, alert_code,
     previous_scan_gate_id, time_since_previous_scan_ms, min_travel_time_ms,
     ticket_assigned_gate_id, distinct_wrong_gate_count)
VALUES
 ('A0000000-0000-0000-0000-000000000009', N'EV001', N'TK006', N'SC_A1', N'GATE_A', N'OP_A', NULL,
  N'TK006', 0, '2026-12-12T18:07:09.500', '2026-12-12T18:07:10.000', '2026-12-12T18:07:10.200',
  N'UNUSED', N'VALID_ENTRY', N'VALID', N'NONE', NULL, NULL, NULL, NULL, NULL, NULL),
 ('A0000000-0000-0000-0000-000000000010', N'EV001', NULL, N'SC_A1', N'GATE_A', N'OP_A', NULL,
  N'xyz', 1, '2026-12-12T18:07:29.500', '2026-12-12T18:07:30.000', '2026-12-12T18:07:30.200',
  NULL, NULL, N'INVALID', N'FRAUD', N'INVALID_QR', NULL, NULL, NULL, NULL, NULL);
INSERT INTO dbo.fraud_alert (scan_event_id, alert_code, alert_level, created_at)
VALUES ('A0000000-0000-0000-0000-000000000010', N'INVALID_QR', N'FRAUD', '2026-12-12T18:07:30.300');

EXEC dbo.usp_refresh_gold @event_id = N'EV001';

IF (SELECT total_scans FROM dbo.gold_gate_stats WHERE event_id = N'EV001' AND gate_id = N'GATE_A') = 4
   AND (SELECT SUM(total_scans) FROM dbo.gold_event_stats) = 10
   AND (SELECT COUNT(*) FROM dbo.gold_event_stats WHERE event_id = N'EV001') = 4
   AND (SELECT COUNT(*) FROM dbo.gold_alert) = 6
   AND (SELECT raw_qr_preview FROM dbo.gold_alert WHERE scan_event_id = 'A0000000-0000-0000-0000-000000000006') = N'MARKER'
    PRINT N'PASS: lượt quét mới được cộng vào, cảnh báo mới được thêm, cảnh báo cũ giữ nguyên';
ELSE BEGIN PRINT N'FAIL: số liệu sau khi thêm lượt quét mới sai'; SET @fail += 1; END

DECLARE @err_no INT = 0;
BEGIN TRY
    EXEC dbo.usp_refresh_gold @event_id = N'KHONG_TON_TAI';
END TRY
BEGIN CATCH
    SET @err_no = ERROR_NUMBER();
END CATCH
IF @err_no = 50001
    PRINT N'PASS: event_id không tồn tại thì báo lỗi 50001';
ELSE BEGIN PRINT N'FAIL: event_id không tồn tại mà không báo lỗi đúng'; SET @fail += 1; END

DELETE FROM dbo.gold_alert;
DELETE FROM dbo.fraud_alert;
DELETE FROM dbo.scan_event;
DELETE FROM dbo.gold_gate_stats;
DELETE FROM dbo.gold_event_stats;
DROP TABLE #g1; DROP TABLE #e1; DROP TABLE #a1;

IF @fail = 0 PRINT N'=== TẤT CẢ ĐẠT ===';
ELSE PRINT N'=== CÓ LỖI, số phép kiểm tra FAIL: ' + CAST(@fail AS NVARCHAR(10)) + N' ===';
GO
