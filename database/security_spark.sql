USE master;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.server_principals
    WHERE name = 'spark_user'
)
BEGIN
    CREATE LOGIN spark_user
    WITH PASSWORD = '$(SparkPass)',
         CHECK_POLICY = OFF;
END;
GO

USE ticket_system;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = 'spark_user'
)
BEGIN
    CREATE USER spark_user FOR LOGIN spark_user;
END;
GO

-- Thu hoi cac quyen thua tu phien ban cu.
REVOKE UPDATE, DELETE ON dbo.scan_event FROM spark_user;
REVOKE SELECT, UPDATE, DELETE ON dbo.fraud_alert FROM spark_user;

-- Spark khong can truy cap truc tiep cac bang Gold.
REVOKE SELECT, INSERT, UPDATE, DELETE
ON dbo.gold_event_stats FROM spark_user;

REVOKE SELECT, INSERT, UPDATE, DELETE
ON dbo.gold_gate_stats FROM spark_user;

REVOKE SELECT, INSERT, UPDATE, DELETE
ON dbo.gold_alert FROM spark_user;

REVOKE SELECT ON dbo.gate FROM spark_user;

-- Quyen can thiet cho Silver.
GRANT SELECT, UPDATE ON dbo.ticket TO spark_user;
GRANT SELECT, INSERT ON dbo.scan_event TO spark_user;
GRANT INSERT ON dbo.fraud_alert TO spark_user;

-- Doc du lieu phuc vu kiem tra nghiep vu.
GRANT SELECT ON dbo.[event] TO spark_user;
GRANT SELECT ON dbo.event_gate TO spark_user;
GRANT SELECT ON dbo.gate_travel_time TO spark_user;
GRANT SELECT ON dbo.scanner TO spark_user;
GRANT SELECT ON dbo.app_user TO spark_user;

-- Cap nhat Gold thong qua stored procedure.
GRANT EXECUTE ON dbo.usp_refresh_gold TO spark_user;
GO

PRINT 'security_spark.sql: completed successfully.';
GO
