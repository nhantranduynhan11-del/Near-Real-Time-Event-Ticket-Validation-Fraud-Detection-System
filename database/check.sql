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
GO
