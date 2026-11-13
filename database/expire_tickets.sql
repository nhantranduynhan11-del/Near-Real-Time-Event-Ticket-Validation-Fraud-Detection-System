USE ticket_system;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @event_id     NVARCHAR(20) = N'EV001';
DECLARE @now_override DATETIME2(3) = NULL;
DECLARE @now          DATETIME2(3) = COALESCE(@now_override, DATEADD(HOUR, 7, SYSUTCDATETIME()));

UPDATE t
SET    t.ticket_status = N'EXPIRED'
FROM   dbo.ticket AS t
JOIN   dbo.[event] AS e ON e.event_id = t.event_id
WHERE  t.event_id = @event_id
  AND  t.ticket_status = N'UNUSED'
  AND  @now > e.admission_end;

PRINT N'Số vé chuyển sang EXPIRED: ' + CAST(@@ROWCOUNT AS NVARCHAR(10));

SELECT ticket_id, ticket_status
FROM   dbo.ticket
WHERE  event_id = @event_id
ORDER BY ticket_id;
GO
