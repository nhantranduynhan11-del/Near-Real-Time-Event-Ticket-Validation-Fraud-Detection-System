USE ticket_system;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_exp_scan_event_gate' AND object_id = OBJECT_ID(N'dbo.scan_event'))
    CREATE INDEX IX_exp_scan_event_gate ON dbo.scan_event (gate_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_exp_app_user_role' AND object_id = OBJECT_ID(N'dbo.app_user'))
    CREATE INDEX IX_exp_app_user_role ON dbo.app_user (role);
GO
