"""spark/gold.py - Chỗ nối Silver -> Gold (thỏa thuận B và A, Design/13_Bronze_Silver.md phần E).

Logic Gold là của Role A, viết bằng SQL trong thủ tục dbo.usp_refresh_gold (database/init.sql).
Tệp này chỉ gọi thủ tục đó.

Hợp đồng:
- Job Silver gọi refresh_gold(db, event_id, batch_id) NGAY SAU khi một micro-batch Silver đã
  COMMIT, và một lần lúc job khởi động (batch_id=None) để bù phần còn sót.
- usp_refresh_gold tính lại 3 bảng Gold của file 14 TỪ BẢNG scan_event (và fraud_alert), không
  cộng dồn, nên gọi lại bao nhiêu lần cũng ra cùng kết quả. Thủ tục tự mở giao dịch và tự khóa
  (sp_getapplock) để hai lần gọi không chồng nhau.
- Ném lỗi thì Silver ghi log rồi gọi lại sau; Silver KHÔNG dừng vì Gold.
- event_id = ACTIVE_EVENT_ID; Spark ghi cột này vào mọi dòng scan_event.
"""
SQL_REFRESH_GOLD = "EXEC dbo.usp_refresh_gold @event_id = ?"
SQL_HAS_PROCEDURE = ("SELECT (SELECT 1 AS ok WHERE OBJECT_ID(N'dbo.usp_refresh_gold', N'P') IS NOT NULL "
                     "FOR JSON PATH) AS has_proc")

_state = {"checked": False, "available": False}


def _procedure_available(db):
    """Kiểm một lần: DB dựng từ init.sql cũ (trước khi A thêm thủ tục) thì chưa có."""
    if not _state["checked"]:
        with db.transaction():
            (rows,) = db.query_json(SQL_HAS_PROCEDURE)
        _state["available"] = bool(rows)
        _state["checked"] = True
        if not _state["available"]:
            print("[gold] Chưa có dbo.usp_refresh_gold trong DB, bỏ qua Gold. Dựng lại DB để nạp "
                  "init.sql mới: docker compose -f docker/docker-compose.yml --env-file docker/.env "
                  "--profile full down -v, rồi ./scripts/up.sh full", flush=True)
    return _state["available"]


def refresh_gold(db, event_id, batch_id=None):  # noqa: ARG001 - batch_id để ghi log nếu cần
    """Tính lại gold_gate_stats, gold_event_stats, gold_alert cho event_id."""
    if not _procedure_available(db):
        return
    # Thủ tục tự BEGIN/COMMIT nên phải chạy ở chế độ tự commit (xem SqlServer.execute_autocommit)
    db.execute_autocommit(SQL_REFRESH_GOLD, event_id)
