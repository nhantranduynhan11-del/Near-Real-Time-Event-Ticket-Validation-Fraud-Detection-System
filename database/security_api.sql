USE master;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.server_principals
    WHERE name = 'api_user'
)
BEGIN
    CREATE LOGIN api_user
    WITH PASSWORD = '$(ApiPass)',
         CHECK_POLICY = OFF;
END;
GO

USE ticket_system;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = 'api_user'
)
BEGIN
    CREATE USER api_user FOR LOGIN api_user;
END;
GO

-- Thu hoi cac quyen thua tu phien ban cu.
REVOKE INSERT, UPDATE, DELETE ON dbo.scan_event FROM api_user;
REVOKE INSERT, UPDATE, DELETE ON dbo.fraud_alert FROM api_user;
REVOKE INSERT, DELETE ON dbo.[event] FROM api_user;
REVOKE UPDATE ON dbo.event_gate FROM api_user;
REVOKE INSERT, UPDATE, DELETE ON dbo.gate FROM api_user;
REVOKE INSERT, UPDATE, DELETE ON dbo.scanner FROM api_user;

-- Doc ket qua quet va canh bao.
GRANT SELECT ON dbo.scan_event TO api_user;
GRANT SELECT ON dbo.fraud_alert TO api_user;

-- Dashboard chi doc du lieu Gold.
GRANT SELECT ON dbo.gold_event_stats TO api_user;
GRANT SELECT ON dbo.gold_gate_stats TO api_user;
GRANT SELECT ON dbo.gold_alert TO api_user;

-- Quan ly ve.
GRANT SELECT, INSERT, UPDATE, DELETE
ON dbo.ticket TO api_user;

-- Quan ly su kien.
GRANT SELECT, UPDATE
ON dbo.[event] TO api_user;

-- Cap nhat danh sach cong cua su kien.
GRANT SELECT, INSERT, DELETE
ON dbo.event_gate TO api_user;

-- Tra cuu cong, may quet va tai khoan.
GRANT SELECT ON dbo.gate TO api_user;
GRANT SELECT ON dbo.scanner TO api_user;
GRANT SELECT ON dbo.app_user TO api_user;
GO

PRINT 'security_api.sql: completed successfully.';
GO
