/* =====================================================================
   checks.sql — Kiểm tra các ràng buộc không viết được bằng khóa hay CHECK
   Chạy sau seed.sql. Mỗi truy vấn trả về 0 dòng là đạt.
   ===================================================================== */
USE ticket_system;
GO

-- 1. Tham gia toàn phần: sự kiện nào cũng mở ít nhất một cổng
SELECT N'Sự kiện chưa mở cổng nào' AS loi, e.event_id
FROM dbo.[event] e
WHERE NOT EXISTS (SELECT 1 FROM dbo.event_gate eg WHERE eg.event_id = e.event_id);

-- 2. Thời gian đi bộ phải đối xứng: (A, D) và (D, A) có cùng số
SELECT N'Thiếu chiều ngược hoặc lệch số' AS loi, t.gate_id_1, t.gate_id_2, t.min_travel_time_ms
FROM dbo.gate_travel_time t
LEFT JOIN dbo.gate_travel_time r
       ON r.gate_id_1 = t.gate_id_2 AND r.gate_id_2 = t.gate_id_1
WHERE r.gate_id_1 IS NULL OR r.min_travel_time_ms <> t.min_travel_time_ms;

-- 3. operator_id (nếu có) phải là nhân viên soát vé
SELECT N'operator_id không phải GATE_OPERATOR' AS loi, s.scan_event_id, s.operator_id
FROM dbo.scan_event s
JOIN dbo.app_user u ON u.user_id = s.operator_id
WHERE u.role <> N'GATE_OPERATOR';

-- 4. Lượt quét có cảnh báo phải có đúng một dòng fraud_alert khớp mã, và ngược lại
SELECT N'Lượt quét có cảnh báo nhưng thiếu fraud_alert' AS loi, s.scan_event_id
FROM dbo.scan_event s
LEFT JOIN dbo.fraud_alert f ON f.scan_event_id = s.scan_event_id
WHERE s.alert_level <> N'NONE' AND f.scan_event_id IS NULL;

SELECT N'fraud_alert không khớp lượt quét' AS loi, f.scan_event_id
FROM dbo.fraud_alert f
JOIN dbo.scan_event s ON s.scan_event_id = f.scan_event_id
WHERE s.alert_level = N'NONE' OR s.alert_code <> f.alert_code OR s.alert_level <> f.alert_level;

-- Các mục 5-7 đối chiếu Gold với Silver. Gold do dbo.usp_refresh_gold tính lại từ scan_event
-- sau mỗi đợt xử lý, nên chạy lúc Spark không đang ghi đợt nào, hoặc chạy
-- EXEC dbo.usp_refresh_gold @event_id = N'EV001'; trước, nếu không có thể lệch tạm thời.

-- 5. gold_gate_stats phải bằng số tính lại từ scan_event, theo từng sự kiện và cổng
WITH src AS (
    SELECT event_id, gate_id,
           COUNT(*) AS total_scans,
           SUM(CASE WHEN scan_result = N'VALID'      THEN 1 ELSE 0 END) AS cnt_valid,
           SUM(CASE WHEN scan_result = N'INVALID'    THEN 1 ELSE 0 END) AS cnt_invalid,
           SUM(CASE WHEN scan_result = N'USED'       THEN 1 ELSE 0 END) AS cnt_used,
           SUM(CASE WHEN scan_result = N'CANCELLED'  THEN 1 ELSE 0 END) AS cnt_cancelled,
           SUM(CASE WHEN scan_result = N'EXPIRED'    THEN 1 ELSE 0 END) AS cnt_expired,
           SUM(CASE WHEN scan_result = N'WRONG_GATE' THEN 1 ELSE 0 END) AS cnt_wrong_gate,
           SUM(CASE WHEN alert_level = N'FRAUD'      THEN 1 ELSE 0 END) AS fraud_count,
           SUM(CASE WHEN alert_level = N'WARNING'    THEN 1 ELSE 0 END) AS warning_count
    FROM dbo.scan_event
    GROUP BY event_id, gate_id
)
SELECT N'gold_gate_stats thiếu hoặc lệch so với scan_event' AS loi, x.*
FROM (SELECT * FROM src
      EXCEPT
      SELECT event_id, gate_id, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled,
             cnt_expired, cnt_wrong_gate, fraud_count, warning_count
      FROM dbo.gold_gate_stats) AS x
UNION ALL
SELECT N'gold_gate_stats dư hoặc lệch so với scan_event', y.*
FROM (SELECT event_id, gate_id, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled,
             cnt_expired, cnt_wrong_gate, fraud_count, warning_count
      FROM dbo.gold_gate_stats
      EXCEPT
      SELECT * FROM src) AS y;

-- 6. gold_event_stats phải bằng số tính lại từ scan_event, theo từng phút (received_at)
WITH src AS (
    SELECT event_id,
           DATEADD(MINUTE, DATEDIFF(MINUTE, CAST('19000101' AS DATETIME2(3)), received_at),
                   CAST('19000101' AS DATETIME2(3))) AS bucket_start,
           COUNT(*) AS total_scans,
           SUM(CASE WHEN scan_result = N'VALID'      THEN 1 ELSE 0 END) AS cnt_valid,
           SUM(CASE WHEN scan_result = N'INVALID'    THEN 1 ELSE 0 END) AS cnt_invalid,
           SUM(CASE WHEN scan_result = N'USED'       THEN 1 ELSE 0 END) AS cnt_used,
           SUM(CASE WHEN scan_result = N'CANCELLED'  THEN 1 ELSE 0 END) AS cnt_cancelled,
           SUM(CASE WHEN scan_result = N'EXPIRED'    THEN 1 ELSE 0 END) AS cnt_expired,
           SUM(CASE WHEN scan_result = N'WRONG_GATE' THEN 1 ELSE 0 END) AS cnt_wrong_gate,
           SUM(CASE WHEN alert_level = N'FRAUD'      THEN 1 ELSE 0 END) AS fraud_count,
           SUM(CASE WHEN alert_level = N'WARNING'    THEN 1 ELSE 0 END) AS warning_count
    FROM dbo.scan_event
    GROUP BY event_id,
             DATEADD(MINUTE, DATEDIFF(MINUTE, CAST('19000101' AS DATETIME2(3)), received_at),
                     CAST('19000101' AS DATETIME2(3)))
)
SELECT N'gold_event_stats thiếu hoặc lệch so với scan_event' AS loi, x.*
FROM (SELECT * FROM src
      EXCEPT
      SELECT event_id, bucket_start, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled,
             cnt_expired, cnt_wrong_gate, fraud_count, warning_count
      FROM dbo.gold_event_stats) AS x
UNION ALL
SELECT N'gold_event_stats dư hoặc lệch so với scan_event', y.*
FROM (SELECT event_id, bucket_start, total_scans, cnt_valid, cnt_invalid, cnt_used, cnt_cancelled,
             cnt_expired, cnt_wrong_gate, fraud_count, warning_count
      FROM dbo.gold_event_stats
      EXCEPT
      SELECT * FROM src) AS y;

-- 7. gold_alert: mỗi lượt quét có cảnh báo phải có đúng một dòng khớp, và không có dòng thừa
SELECT N'gold_alert thiếu cảnh báo có trong scan_event' AS loi, s.scan_event_id
FROM dbo.scan_event AS s
WHERE s.alert_level <> N'NONE'
  AND NOT EXISTS (SELECT 1 FROM dbo.gold_alert AS g WHERE g.scan_event_id = s.scan_event_id)
UNION ALL
SELECT N'gold_alert dư, không có cảnh báo tương ứng trong scan_event', g.scan_event_id
FROM dbo.gold_alert AS g
WHERE NOT EXISTS (SELECT 1 FROM dbo.scan_event AS s
                  WHERE s.scan_event_id = g.scan_event_id AND s.alert_level <> N'NONE')
UNION ALL
SELECT N'gold_alert lệch cột so với scan_event', g.scan_event_id
FROM dbo.gold_alert AS g
JOIN dbo.scan_event AS s ON s.scan_event_id = g.scan_event_id
WHERE g.event_id    <> s.event_id
   OR g.alert_level <> s.alert_level
   OR g.alert_code  <> s.alert_code
   OR g.scan_result <> s.scan_result
   OR g.gate_id     <> s.gate_id
   OR g.scanner_id  <> s.scanner_id
   OR ISNULL(g.ticket_id, N'') <> ISNULL(s.ticket_id, N'');
GO
