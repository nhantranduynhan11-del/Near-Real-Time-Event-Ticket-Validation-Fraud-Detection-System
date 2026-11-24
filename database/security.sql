USE master;
GO
IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = 'api_user')
    CREATE LOGIN api_user WITH PASSWORD = 'ApiPass@123', CHECK_POLICY = OFF;
IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = 'spark_user')
    CREATE LOGIN spark_user WITH PASSWORD = 'SparkPass@123', CHECK_POLICY = OFF;
GO

USE ticket_system;
GO
IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = 'api_user')
    CREATE USER api_user FOR LOGIN api_user;
IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = 'spark_user')
    CREATE USER spark_user FOR LOGIN spark_user;
GO

-- Phân quyền cho API
GRANT SELECT ON dbo.scan_event TO api_user;
GRANT SELECT ON dbo.fraud_alert TO api_user;
GRANT SELECT ON dbo.gold_event_stats TO api_user;
GRANT SELECT ON dbo.gold_gate_stats TO api_user;
GRANT SELECT ON dbo.gold_alert TO api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.ticket TO api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.[event] TO api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.event_gate TO api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.gate TO api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.scanner TO api_user;
GRANT SELECT ON dbo.app_user TO api_user;

-- Phân quyền cho Spark
GRANT SELECT, INSERT, UPDATE ON dbo.scan_event TO spark_user;
GRANT SELECT, INSERT, UPDATE ON dbo.fraud_alert TO spark_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.gold_event_stats TO spark_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.gold_gate_stats TO spark_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.gold_alert TO spark_user;
GRANT SELECT, UPDATE ON dbo.ticket TO spark_user;
GRANT SELECT ON dbo.[event] TO spark_user;
GRANT SELECT ON dbo.event_gate TO spark_user;
GRANT SELECT ON dbo.gate TO spark_user;
GRANT SELECT ON dbo.scanner TO spark_user;
GRANT SELECT ON dbo.gate_travel_time TO spark_user;
GO