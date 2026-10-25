USE ticket_system;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.[event] WHERE event_id = N'EV001')
    INSERT INTO dbo.[event] (event_id, event_name, admission_start, admission_end)
    VALUES (N'EV001', N'Đêm nhạc mẫu demo',
            DATEADD(HOUR, 7, SYSUTCDATETIME()),
            DATEADD(HOUR, 7, DATEADD(HOUR, 5, SYSUTCDATETIME())));
GO

IF NOT EXISTS (SELECT 1 FROM dbo.gate WHERE gate_id = N'GATE_A')
BEGIN
    INSERT INTO dbo.gate (gate_id, gate_name) VALUES
        (N'GATE_A', N'Cổng A'),
        (N'GATE_B', N'Cổng B'),
        (N'GATE_C', N'Cổng C'),
        (N'GATE_D', N'Cổng D');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.event_gate WHERE event_id = N'EV001' AND gate_id = N'GATE_A')
BEGIN
    INSERT INTO dbo.event_gate (event_id, gate_id) VALUES
        (N'EV001', N'GATE_A'),
        (N'EV001', N'GATE_B'),
        (N'EV001', N'GATE_C'),
        (N'EV001', N'GATE_D');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.gate_travel_time WHERE gate_id_1 = N'GATE_A' AND gate_id_2 = N'GATE_B')
BEGIN
    INSERT INTO dbo.gate_travel_time (gate_id_1, gate_id_2, min_travel_time_ms) VALUES
        (N'GATE_A', N'GATE_B', 60000), (N'GATE_B', N'GATE_A', 60000),
        (N'GATE_A', N'GATE_C', 90000), (N'GATE_C', N'GATE_A', 90000),
        (N'GATE_A', N'GATE_D', 120000), (N'GATE_D', N'GATE_A', 120000),
        (N'GATE_B', N'GATE_C', 60000), (N'GATE_C', N'GATE_B', 60000),
        (N'GATE_B', N'GATE_D', 90000), (N'GATE_D', N'GATE_B', 90000),
        (N'GATE_C', N'GATE_D', 60000), (N'GATE_D', N'GATE_C', 60000);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.scanner WHERE scanner_id = N'SCN_A1')
BEGIN
    INSERT INTO dbo.scanner (scanner_id, gate_id) VALUES
        (N'SCN_A1', N'GATE_A'),
        (N'SCN_B1', N'GATE_B'),
        (N'SCN_C1', N'GATE_C'),
        (N'SCN_D1', N'GATE_D');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.app_user WHERE user_id = N'U001')
BEGIN
    INSERT INTO dbo.app_user (user_id, username, password_hash, last_name, first_name, phone, role) VALUES
        (N'U001', N'gate.a', N'$2b$10$seedhashplaceholder000000000000000000000000000', N'Nguyễn', N'Văn A', N'0900000001', N'GATE_OPERATOR'),
        (N'U002', N'supervisor', N'$2b$10$seedhashplaceholder000000000000000000000000000', N'Trần', N'Thị B', N'0900000002', N'EVENT_SUPERVISOR');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ticket WHERE ticket_id = N'TK00001')
BEGIN
    INSERT INTO dbo.ticket (ticket_id, event_id, assigned_gate_id, ticket_status) VALUES
        (N'TK00001', N'EV001', N'GATE_A', N'UNUSED'),
        (N'TK00002', N'EV001', N'GATE_B', N'UNUSED'),
        (N'TK00003', N'EV001', NULL,      N'UNUSED');
END
GO

PRINT N'seed.sql: hoàn tất.';
GO
