

USE ticket_system;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

DECLARE @event_id NVARCHAR(20) = N'EV001';
DECLARE @prefix   NVARCHAR(2)  = N'LT';

BEGIN TRANSACTION;

DELETE FROM dbo.gold_alert
WHERE scan_event_id IN (SELECT scan_event_id FROM dbo.scan_event
                        WHERE ticket_id LIKE @prefix + N'%' OR raw_qr_payload LIKE N'LOAD:%');

DELETE FROM dbo.fraud_alert
WHERE scan_event_id IN (SELECT scan_event_id FROM dbo.scan_event
                        WHERE ticket_id LIKE @prefix + N'%' OR raw_qr_payload LIKE N'LOAD:%');

DELETE FROM dbo.scan_event
WHERE ticket_id LIKE @prefix + N'%' OR raw_qr_payload LIKE N'LOAD:%';

DELETE FROM dbo.ticket
WHERE ticket_id LIKE @prefix + N'%';

COMMIT TRANSACTION;

EXEC dbo.usp_refresh_gold @event_id = @event_id;

SELECT N've tai con lai (phai la 0)' AS bang, COUNT(*) AS so_dong FROM dbo.ticket WHERE ticket_id LIKE @prefix + N'%'
UNION ALL
SELECT N'scan_event tai con lai (phai la 0)', COUNT(*) FROM dbo.scan_event
WHERE ticket_id LIKE @prefix + N'%' OR raw_qr_payload LIKE N'LOAD:%'
UNION ALL
SELECT N'scan_event con lai (du lieu that va mau)', COUNT(*) FROM dbo.scan_event;
GO
