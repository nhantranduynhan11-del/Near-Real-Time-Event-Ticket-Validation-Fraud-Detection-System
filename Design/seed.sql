/* =====================================================================
   seed.sql — Dữ liệu mẫu bắt buộc (Requirements/10_Test_Cases.md)
   Chạy sau init.sql.

   Chạy được nhiều lần: dòng nào đã có thì bỏ qua. Script KHÔNG ghi đè
   dữ liệu đang có, nên khởi động lại Docker không làm mất trạng thái vé
   hay lịch sử quét. Muốn đưa về trạng thái ban đầu trước mỗi ca kiểm
   thử, chạy reset_test_data.sql.

   Giờ giấc: cơ sở dữ liệu lưu giờ Việt Nam (UTC+7), nên giờ ở đây ghi
   đúng như file 10. Ngày demo chọn là 12/12/2026.
   Đổi ngày demo thì sửa hai dòng sự kiện ở mục 1.
   ===================================================================== */

USE ticket_system;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;   -- lỗi ở bất kỳ câu nào thì hủy toàn bộ
BEGIN TRANSACTION;

/* 1. Sự kiện ---------------------------------------------------------- */
INSERT INTO dbo.[event] (event_id, event_name, admission_start, admission_end)
SELECT v.event_id, v.event_name, v.admission_start, v.admission_end
FROM (VALUES
    (N'EV001', N'Concert Demo', CAST('2026-12-12T18:00:00' AS DATETIME2(3)), CAST('2026-12-12T20:00:00' AS DATETIME2(3))),
    (N'EV002', N'Sự kiện khác', CAST('2026-12-12T18:00:00' AS DATETIME2(3)), CAST('2026-12-12T22:00:00' AS DATETIME2(3)))
) AS v (event_id, event_name, admission_start, admission_end)
WHERE NOT EXISTS (SELECT 1 FROM dbo.[event] e WHERE e.event_id = v.event_id);

/* 2. Cổng (cổng thật của địa điểm, dùng chung cho các sự kiện) --------- */
INSERT INTO dbo.gate (gate_id, gate_name)
SELECT v.gate_id, v.gate_name
FROM (VALUES
    (N'GATE_A', N'Cổng A'),
    (N'GATE_B', N'Cổng B'),
    (N'GATE_C', N'Cổng C'),
    (N'GATE_D', N'Cổng D')
) AS v (gate_id, gate_name)
WHERE NOT EXISTS (SELECT 1 FROM dbo.gate g WHERE g.gate_id = v.gate_id);

/* 3. Sự kiện mở cổng nào --------------------------------------------
   EV001 mở cả 4 cổng (file 10), nên N = 4 và ngưỡng WRONG_GATE_FRAUD là 3.
   EV002 mở GATE_A và GATE_B. File 10 chỉ ghi "cổng của EV002", hai cổng
   này là lựa chọn của nhóm và không ảnh hưởng ca kiểm thử nào.            */
INSERT INTO dbo.event_gate (event_id, gate_id)
SELECT v.event_id, v.gate_id
FROM (VALUES
    (N'EV001', N'GATE_A'),
    (N'EV001', N'GATE_B'),
    (N'EV001', N'GATE_C'),
    (N'EV001', N'GATE_D'),
    (N'EV002', N'GATE_A'),
    (N'EV002', N'GATE_B')
) AS v (event_id, gate_id)
WHERE NOT EXISTS (SELECT 1 FROM dbo.event_gate eg
                  WHERE eg.event_id = v.event_id AND eg.gate_id = v.gate_id);

/* 4. Thời gian đi bộ tối thiểu (mili giây, lưu cả hai chiều: 12 dòng) */
INSERT INTO dbo.gate_travel_time (gate_id_1, gate_id_2, min_travel_time_ms)
SELECT v.gate_id_1, v.gate_id_2, v.min_travel_time_ms
FROM (VALUES
    (N'GATE_A', N'GATE_B',  45000), (N'GATE_B', N'GATE_A',  45000),
    (N'GATE_A', N'GATE_C',  90000), (N'GATE_C', N'GATE_A',  90000),
    (N'GATE_A', N'GATE_D', 140000), (N'GATE_D', N'GATE_A', 140000),
    (N'GATE_B', N'GATE_C',  60000), (N'GATE_C', N'GATE_B',  60000),
    (N'GATE_B', N'GATE_D', 100000), (N'GATE_D', N'GATE_B', 100000),
    (N'GATE_C', N'GATE_D',  50000), (N'GATE_D', N'GATE_C',  50000)
) AS v (gate_id_1, gate_id_2, min_travel_time_ms)
WHERE NOT EXISTS (SELECT 1 FROM dbo.gate_travel_time t
                  WHERE t.gate_id_1 = v.gate_id_1 AND t.gate_id_2 = v.gate_id_2);

/* 5. Máy quét --------------------------------------------------------- */
INSERT INTO dbo.scanner (scanner_id, gate_id)
SELECT v.scanner_id, v.gate_id
FROM (VALUES
    (N'SC_A1', N'GATE_A'),
    (N'SC_B1', N'GATE_B'),
    (N'SC_C1', N'GATE_C'),
    (N'SC_D1', N'GATE_D')
) AS v (scanner_id, gate_id)
WHERE NOT EXISTS (SELECT 1 FROM dbo.scanner s WHERE s.scanner_id = v.scanner_id);

/* 6. Người dùng --------------------------------------------------------
   File 10 không quy định người dùng. Nhóm thêm 4 nhân viên soát vé (mỗi
   cổng một người) và 1 người giám sát để demo đăng nhập.
   Mật khẩu demo của mọi tài khoản: Demo@123 (bcrypt, cost 10).
   CHỈ DÙNG CHO DEMO, không dùng mật khẩu này ở nơi khác.                */
DECLARE @demo_hash NVARCHAR(255) = N'$2b$10$uFh.p9INxlgA5mFgk14A3efGe603s2Hc/oBhFCU0X2Gv6jJRPFWJa';

INSERT INTO dbo.app_user (user_id, username, password_hash, last_name, first_name, phone, role)
SELECT v.user_id, v.username, @demo_hash, v.last_name, v.first_name, v.phone, v.role
FROM (VALUES
    (N'OP_A', N'op_gate_a',  N'Nguyễn', N'An',   N'0900000001', N'GATE_OPERATOR'),
    (N'OP_B', N'op_gate_b',  N'Trần',   N'Bình', N'0900000002', N'GATE_OPERATOR'),
    (N'OP_C', N'op_gate_c',  N'Lê',     N'Chi',  N'0900000003', N'GATE_OPERATOR'),
    (N'OP_D', N'op_gate_d',  N'Phạm',   N'Dũng', N'0900000004', N'GATE_OPERATOR'),
    (N'SUP1', N'supervisor', N'Võ',     N'Giang', N'0900000005', N'EVENT_SUPERVISOR')
) AS v (user_id, username, last_name, first_name, phone, role)
WHERE NOT EXISTS (SELECT 1 FROM dbo.app_user u WHERE u.user_id = v.user_id);

/* 7. Vé (trạng thái ban đầu theo file 10) ---------------------------- */
INSERT INTO dbo.ticket (ticket_id, event_id, assigned_gate_id, ticket_status)
SELECT v.ticket_id, v.event_id, v.assigned_gate_id, v.ticket_status
FROM (VALUES
    (N'TK001', N'EV001', N'GATE_A', N'UNUSED'),
    (N'TK002', N'EV001', N'GATE_B', N'UNUSED'),
    (N'TK003', N'EV001', N'GATE_C', N'CANCELLED'),
    (N'TK004', N'EV001', N'GATE_B', N'UNUSED'),
    (N'TK005', N'EV002', N'GATE_A', N'UNUSED'),
    (N'TK006', N'EV001', N'GATE_A', N'UNUSED'),
    (N'TK007', N'EV001', N'GATE_C', N'UNUSED')
) AS v (ticket_id, event_id, assigned_gate_id, ticket_status)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ticket t WHERE t.ticket_id = v.ticket_id);

COMMIT TRANSACTION;
GO

/* Tóm tắt số dòng để đối chiếu nhanh
   Mong đợi: event 2, gate 4, event_gate 6, gate_travel_time 12,
             scanner 4, app_user 5, ticket 7                              */
SELECT N'event' AS bang, COUNT(*) AS so_dong FROM dbo.[event]
UNION ALL SELECT N'gate',             COUNT(*) FROM dbo.gate
UNION ALL SELECT N'event_gate',       COUNT(*) FROM dbo.event_gate
UNION ALL SELECT N'gate_travel_time', COUNT(*) FROM dbo.gate_travel_time
UNION ALL SELECT N'scanner',          COUNT(*) FROM dbo.scanner
UNION ALL SELECT N'app_user',         COUNT(*) FROM dbo.app_user
UNION ALL SELECT N'ticket',           COUNT(*) FROM dbo.ticket;
GO
