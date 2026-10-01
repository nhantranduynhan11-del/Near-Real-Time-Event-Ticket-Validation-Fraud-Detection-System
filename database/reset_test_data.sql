/* =====================================================================
   reset_test_data.sql — Đưa dữ liệu về trạng thái ban đầu trước mỗi ca
   kiểm thử (file 10: "Trước mỗi ca, nạp lại dữ liệu mẫu về trạng thái
   ban đầu").

   XÓA TOÀN BỘ lượt quét và cảnh báo, rồi trả trạng thái 7 vé mẫu về như
   file 10. Chỉ chạy trên máy dev hoặc lúc demo, không chạy tự động.
   Nhớ xóa cả Bronze (data/bronze/scan_events/) và checkpoint của Spark,
   nếu không Spark sẽ nhớ các lượt quét cũ.
   ===================================================================== */

USE ticket_system;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DELETE FROM dbo.fraud_alert;
DELETE FROM dbo.scan_event;   -- một câu DELETE xóa hết, khóa ngoại tự tham chiếu không cản

UPDATE t
SET    t.ticket_status = v.ticket_status
FROM   dbo.ticket t
JOIN  (VALUES
        (N'TK001', N'UNUSED'),
        (N'TK002', N'UNUSED'),
        (N'TK003', N'CANCELLED'),
        (N'TK004', N'UNUSED'),
        (N'TK005', N'UNUSED'),
        (N'TK006', N'UNUSED'),
        (N'TK007', N'UNUSED')
      ) AS v (ticket_id, ticket_status)
  ON   v.ticket_id = t.ticket_id;

COMMIT TRANSACTION;
GO

SELECT ticket_id, event_id, assigned_gate_id, ticket_status
FROM dbo.ticket
ORDER BY ticket_id;
GO
