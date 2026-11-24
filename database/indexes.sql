USE ticket_system;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_scan_event_ticket_result' AND object_id = OBJECT_ID(N'dbo.scan_event'))
    CREATE INDEX IX_scan_event_ticket_result ON dbo.scan_event (ticket_id, scan_result) INCLUDE (gate_id, received_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_scan_event_received_at' AND object_id = OBJECT_ID(N'dbo.scan_event'))
    CREATE INDEX IX_scan_event_received_at ON dbo.scan_event (received_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_scan_event_gold_cover' AND object_id = OBJECT_ID(N'dbo.scan_event'))
    CREATE INDEX IX_scan_event_gold_cover ON dbo.scan_event (event_id) INCLUDE (gate_id, scan_result, alert_level, received_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ticket_event_status' AND object_id = OBJECT_ID(N'dbo.ticket'))
    CREATE INDEX IX_ticket_event_status ON dbo.ticket (event_id, ticket_status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_gold_alert_event_created' AND object_id = OBJECT_ID(N'dbo.gold_alert'))
    CREATE INDEX IX_gold_alert_event_created ON dbo.gold_alert (event_id, created_at DESC);
GO
