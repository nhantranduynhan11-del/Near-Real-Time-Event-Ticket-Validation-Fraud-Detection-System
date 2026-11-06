"""spark/gold.py - Chỗ nối Silver -> Gold (thỏa thuận B và A, Design/13_Bronze_Silver.md phần E).

ROLE A VIẾT THÂN HÀM refresh_gold(). Role B chỉ gọi nó, không viết logic Gold.

Hợp đồng:
- Job Silver gọi refresh_gold(db, event_id, batch_id) NGAY SAU khi một micro-batch Silver đã
  COMMIT, và một lần lúc job khởi động (batch_id=None) để bù phần còn sót.
- Tính lại 3 bảng Gold của file 14 TỪ BẢNG scan_event (và fraud_alert), không cộng dồn. Gọi
  hai lần liên tiếp phải ra cùng một kết quả (idempotent): Spark có thể gọi lại sau khi khởi động
  lại, hoặc gọi khi batch không có gì mới.
- Tự quản giao dịch:  with db.transaction(): db.execute("...", tham_so_chuoi, ...)
  `db` là sqlserver.SqlServer, dùng chung kết nối với Silver. Tham số luôn là chuỗi (NVARCHAR).
- Ném lỗi thì Silver ghi log rồi gọi lại ở batch sau; Silver KHÔNG dừng vì Gold.
- Không ghi scan_event, fraud_alert, ticket (bảng của Silver).
- event_id = ACTIVE_EVENT_ID. scan_event không có cột event_id, nên mọi dòng scan_event được
  coi là của sự kiện đang chạy (file 15 mục 7.1).
"""
_warned = False


def refresh_gold(db, event_id, batch_id=None):
    """Tính lại gold_gate_stats, gold_event_stats, gold_alert cho event_id. CHỜ ROLE A."""
    global _warned
    if not _warned:
        print(f"[gold] Chưa có module Gold (Role A) - bỏ qua cập nhật Gold cho {event_id}.",
              flush=True)
        _warned = True
