USE ticket_system;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_scan_event_ticket_result' AND object_id = OBJECT_ID(N'dbo.scan_event'))
    DROP INDEX IX_scan_event_ticket_result ON dbo.scan_event;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_scan_event_received_at' AND object_id = OBJECT_ID(N'dbo.scan_event'))
    DROP INDEX IX_scan_event_received_at ON dbo.scan_event;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_scan_event_gold_cover' AND object_id = OBJECT_ID(N'dbo.scan_event'))
    DROP INDEX IX_scan_event_gold_cover ON dbo.scan_event;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_exp_scan_event_gate' AND object_id = OBJECT_ID(N'dbo.scan_event'))
    DROP INDEX IX_exp_scan_event_gate ON dbo.scan_event;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ticket_event_status' AND object_id = OBJECT_ID(N'dbo.ticket'))
    DROP INDEX IX_ticket_event_status ON dbo.ticket;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_gold_alert_event_created' AND object_id = OBJECT_ID(N'dbo.gold_alert'))
    DROP INDEX IX_gold_alert_event_created ON dbo.gold_alert;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_exp_app_user_role' AND object_id = OBJECT_ID(N'dbo.app_user'))
    DROP INDEX IX_exp_app_user_role ON dbo.app_user;
GO
SELECT OBJECT_NAME(object_id) AS bang, name AS chi_muc_con_lai
FROM sys.indexes
WHERE object_id IN (OBJECT_ID(N'dbo.scan_event'), OBJECT_ID(N'dbo.ticket'), OBJECT_ID(N'dbo.gold_alert'), OBJECT_ID(N'dbo.app_user'))
  AND name IS NOT NULL
ORDER BY bang, name;
GO
