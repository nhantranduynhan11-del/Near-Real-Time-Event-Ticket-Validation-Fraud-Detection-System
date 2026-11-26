/* =====================================================================
   measure_indexes.sql - do thoi gian va logical reads truoc/sau khi co index.
   Moi truy van chay 2 lan: lan 1 cache lanh (xoa buffer), lan 2 cache nong.
   Cac truy van viet truc tiep (khong qua sp_executesql) vi ban SQL Server
   tren Linux trong Docker bao loi Msg 17750 khi goi EXEC sp_executesql.
   OPTION (RECOMPILE) de optimizer thay gia tri that cua bien (giong tham so cua sp_executesql).
   Chay: runsql database/measure_indexes.sql > ket_qua.txt
   ===================================================================== */
USE ticket_system;
GO

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

DECLARE @t    NVARCHAR(20) = N'LT000050';
DECLARE @e    NVARCHAR(20) = N'EV001';
DECLARE @from DATETIME2(3) = '2026-12-12T19:00:00';
DECLARE @to   DATETIME2(3) = '2026-12-12T19:05:00';

DECLARE @ids NVARCHAR(MAX) =
    (SELECT N'[' + STRING_AGG(N'"' + ticket_id + N'"', N',') + N']'
     FROM (SELECT TOP (50) ticket_id FROM dbo.ticket WHERE ticket_id LIKE N'LT%' ORDER BY ticket_id) AS b);

DECLARE @n_scan INT = (SELECT COUNT(*) FROM dbo.scan_event),
        @n_ticket INT = (SELECT COUNT(*) FROM dbo.ticket),
        @n_alert INT = (SELECT COUNT(*) FROM dbo.gold_alert);
PRINT N'So dong scan_event: ' + CAST(@n_scan AS NVARCHAR(20));
PRINT N'So dong ticket    : ' + CAST(@n_ticket AS NVARCHAR(20));
PRINT N'So dong gold_alert: ' + CAST(@n_alert AS NVARCHAR(20));

PRINT N'';
PRINT N'=== Q1 Spark mot batch: luot VALID va cong sai da co cua 50 ve (SQL_HISTORY)  [lan 1, cache lanh] ===';
CHECKPOINT;
DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS;
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS so_dong FROM (SELECT s.ticket_id, s.scan_event_id, s.gate_id, s.scan_result,
       DATEDIFF_BIG(MILLISECOND, CAST('1970-01-01T00:00:00' AS DATETIME2(3)), s.received_at) AS received_wall_ms
       FROM dbo.scan_event AS s
       WHERE s.ticket_id IN (SELECT CAST(j.[value] AS NVARCHAR(20)) FROM OPENJSON(@ids) AS j)
         AND s.scan_result IN (N'VALID', N'WRONG_GATE')) AS q OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q1 Spark mot batch: luot VALID va cong sai da co cua 50 ve (SQL_HISTORY)  [lan 2, cache nong] ===';
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS so_dong FROM (SELECT s.ticket_id, s.scan_event_id, s.gate_id, s.scan_result,
       DATEDIFF_BIG(MILLISECOND, CAST('1970-01-01T00:00:00' AS DATETIME2(3)), s.received_at) AS received_wall_ms
       FROM dbo.scan_event AS s
       WHERE s.ticket_id IN (SELECT CAST(j.[value] AS NVARCHAR(20)) FROM OPENJSON(@ids) AS j)
         AND s.scan_result IN (N'VALID', N'WRONG_GATE')) AS q OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q2 API GET /api/tickets/:id: so luot quet, luot VALID, luot quet moi nhat cua mot ve  [lan 1, cache lanh] ===';
CHECKPOINT;
DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS;
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS scan_count FROM dbo.scan_event WHERE ticket_id = @t OPTION (RECOMPILE);
    SELECT TOP (1) scan_event_id, gate_id, received_at FROM dbo.scan_event
      WHERE ticket_id = @t AND scan_result = N'VALID' ORDER BY received_at OPTION (RECOMPILE);
    SELECT TOP (1) scan_event_id, gate_id, received_at, scan_result FROM dbo.scan_event
      WHERE ticket_id = @t ORDER BY received_at DESC OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q2 API GET /api/tickets/:id: so luot quet, luot VALID, luot quet moi nhat cua mot ve  [lan 2, cache nong] ===';
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS scan_count FROM dbo.scan_event WHERE ticket_id = @t OPTION (RECOMPILE);
    SELECT TOP (1) scan_event_id, gate_id, received_at FROM dbo.scan_event
      WHERE ticket_id = @t AND scan_result = N'VALID' ORDER BY received_at OPTION (RECOMPILE);
    SELECT TOP (1) scan_event_id, gate_id, received_at, scan_result FROM dbo.scan_event
      WHERE ticket_id = @t ORDER BY received_at DESC OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q3 API GET /api/scans?from&to: 50 luot quet dau tien trong khoang 5 phut  [lan 1, cache lanh] ===';
CHECKPOINT;
DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS;
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS so_dong FROM (SELECT * FROM dbo.scan_event
      WHERE received_at >= @from AND received_at < @to
      ORDER BY received_at OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY) AS q OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q3 API GET /api/scans?from&to: 50 luot quet dau tien trong khoang 5 phut  [lan 2, cache nong] ===';
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS so_dong FROM (SELECT * FROM dbo.scan_event
      WHERE received_at >= @from AND received_at < @to
      ORDER BY received_at OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY) AS q OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q4 Dashboard live: 20 canh bao moi nhat tu gold_alert  [lan 1, cache lanh] ===';
CHECKPOINT;
DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS;
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS so_dong FROM (SELECT TOP (20) scan_event_id, created_at, alert_level, alert_code, ticket_id, gate_id
      FROM dbo.gold_alert WHERE event_id = @e ORDER BY created_at DESC) AS q OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q4 Dashboard live: 20 canh bao moi nhat tu gold_alert  [lan 2, cache nong] ===';
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS so_dong FROM (SELECT TOP (20) scan_event_id, created_at, alert_level, alert_code, ticket_id, gate_id
      FROM dbo.gold_alert WHERE event_id = @e ORDER BY created_at DESC) AS q OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q5 Dashboard stats / tien trinh het han: so ve theo trang thai cua su kien  [lan 1, cache lanh] ===';
CHECKPOINT;
DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS;
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT ticket_status, COUNT(*) AS so_ve FROM dbo.ticket WHERE event_id = @e GROUP BY ticket_status OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q5 Dashboard stats / tien trinh het han: so ve theo trang thai cua su kien  [lan 2, cache nong] ===';
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT ticket_status, COUNT(*) AS so_ve FROM dbo.ticket WHERE event_id = @e GROUP BY ticket_status OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q6a Gold: truy van tong hop theo cong (phan SELECT cua usp_refresh_gold)  [lan 1, cache lanh] ===';
CHECKPOINT;
DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS;
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT gate_id, COUNT(*) AS total_scans,
           SUM(CASE WHEN scan_result = N'VALID' THEN 1 ELSE 0 END) AS cnt_valid,
           SUM(CASE WHEN alert_level = N'FRAUD' THEN 1 ELSE 0 END) AS fraud_count,
           MAX(received_at) AS last_scan_at
    FROM dbo.scan_event WHERE event_id = @e GROUP BY gate_id OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q6a Gold: truy van tong hop theo cong (phan SELECT cua usp_refresh_gold)  [lan 2, cache nong] ===';
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT gate_id, COUNT(*) AS total_scans,
           SUM(CASE WHEN scan_result = N'VALID' THEN 1 ELSE 0 END) AS cnt_valid,
           SUM(CASE WHEN alert_level = N'FRAUD' THEN 1 ELSE 0 END) AS fraud_count,
           MAX(received_at) AS last_scan_at
    FROM dbo.scan_event WHERE event_id = @e GROUP BY gate_id OPTION (RECOMPILE);
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q6b Gold: EXEC dbo.usp_refresh_gold (ca thu tuc, Spark goi sau moi batch)  [lan 1, cache lanh] ===';
CHECKPOINT;
DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS;
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    EXEC dbo.usp_refresh_gold @event_id = @e;
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Q6b Gold: EXEC dbo.usp_refresh_gold (ca thu tuc, Spark goi sau moi batch)  [lan 2, cache nong] ===';
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    EXEC dbo.usp_refresh_gold @event_id = @e;
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== X1 Thu nghiem: loc theo gate_id (4 cong, moi cong khoang 25% so dong)  [lan 1, cache lanh] ===';
CHECKPOINT;
DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS;
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT MAX(processing_ts) AS max_ts FROM dbo.scan_event WHERE gate_id = N'GATE_A';
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== X1 Thu nghiem: loc theo gate_id (4 cong, moi cong khoang 25% so dong)  [lan 2, cache nong] ===';
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT MAX(processing_ts) AS max_ts FROM dbo.scan_event WHERE gate_id = N'GATE_A';
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== X2 Thu nghiem: loc app_user theo role (bang chi vai dong)  [lan 1, cache lanh] ===';
CHECKPOINT;
DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS;
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS so_nhan_vien FROM dbo.app_user WHERE role = N'GATE_OPERATOR';
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== X2 Thu nghiem: loc app_user theo role (bang chi vai dong)  [lan 2, cache nong] ===';
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
    SELECT COUNT(*) AS so_nhan_vien FROM dbo.app_user WHERE role = N'GATE_OPERATOR';
SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;

PRINT N'';
PRINT N'=== Kich thuoc cac chi muc (MB) ===';
SELECT OBJECT_NAME(i.object_id) AS bang, i.name AS chi_muc, i.type_desc AS loai,
       CAST(SUM(ps.used_page_count) * 8 / 1024.0 AS DECIMAL(10, 2)) AS mb
FROM sys.indexes AS i
JOIN sys.dm_db_partition_stats AS ps ON ps.object_id = i.object_id AND ps.index_id = i.index_id
WHERE i.object_id IN (OBJECT_ID(N'dbo.scan_event'), OBJECT_ID(N'dbo.ticket'), OBJECT_ID(N'dbo.gold_alert'), OBJECT_ID(N'dbo.app_user'))
GROUP BY i.object_id, i.name, i.type_desc
ORDER BY bang, chi_muc;
GO
