"""spark/silver_logic.py - Luật nghiệp vụ của tầng Silver, viết bằng DataFrame (Role B).

File này KHÔNG đụng tới Kafka hay SQL Server: nhận các DataFrame đầu vào, trả DataFrame kết quả.
Nhờ vậy test được riêng bằng spark/tests/test_silver_logic.py.

Nguồn chuẩn của luật:
- Thứ tự 6 bước ra scan_result ......... Requirements/07_Scan_Results.md
- Chuyển trạng thái vé .................. Requirements/06_Ticket_Lifecycle.md
- R1-R4, ngưỡng IMPOSSIBLE_TRAVEL ....... Requirements/09_Fraud_Rules.md
- Tên và ý nghĩa các trường Silver ...... Requirements/08_Scan_Event_Specification.md

Quy ước thời gian: mọi mốc giờ trong file này là số mili giây kể từ 1970-01-01 UTC (epoch ms),
nên so sánh và trừ nhau không phụ thuộc múi giờ. Đổi ra giờ Việt Nam chỉ làm lúc ghi DB.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

# ---------- Hằng số nghiệp vụ ----------
VALID, INVALID, USED, CANCELLED, EXPIRED, WRONG_GATE = (
    "VALID", "INVALID", "USED", "CANCELLED", "EXPIRED", "WRONG_GATE")
UNUSED, VALID_ENTRY, FLAGGED_FRAUD = "UNUSED", "VALID_ENTRY", "FLAGGED_FRAUD"
NONE, WARNING, FRAUD = "NONE", "WARNING", "FRAUD"
INVALID_QR, DUPLICATE_SCAN, IMPOSSIBLE_TRAVEL, REVOKED_TICKET = (
    "INVALID_QR", "DUPLICATE_SCAN", "IMPOSSIBLE_TRAVEL", "REVOKED_TICKET")
WRONG_GATE_WARNING, WRONG_GATE_FRAUD = "WRONG_GATE_WARNING", "WRONG_GATE_FRAUD"

INCONSISTENT_TICKET_STATE = "INCONSISTENT_TICKET_STATE"

VN_OFFSET_MS = 7 * 3600 * 1000  # Việt Nam luôn UTC+7, không đổi giờ theo mùa
INT_MAX = 2_147_483_647          # cột *_ms là INT

# 21 cột Spark ghi vào scan_event (file 13 mục C.1). 4 cột còn lại SQL Server tự tính.
SCAN_EVENT_COLUMNS = [
    "scan_event_id", "ticket_id", "scanner_id", "gate_id", "operator_id", "previous_scan_event_id",
    "raw_qr_payload", "decode_error", "scanned_at", "received_at",
    "processing_ts", "ticket_status_before", "ticket_status_after", "scan_result",
    "alert_level", "alert_code", "previous_scan_gate_id", "time_since_previous_scan_ms",
    "min_travel_time_ms", "ticket_assigned_gate_id", "distinct_wrong_gate_count",
]

# Schema của các DataFrame đầu vào (dùng khi dựng DataFrame từ dữ liệu đọc ở SQL Server)
TICKET_SCHEMA = "ticket_id string, event_id string, assigned_gate_id string, ticket_status string"
VALID_SCAN_SCHEMA = "ticket_id string, scan_event_id string, gate_id string, received_ms long"
WRONG_GATE_SCHEMA = "ticket_id string, gate_id string"
TRAVEL_SCHEMA = "gate_id_1 string, gate_id_2 string, min_travel_time_ms int"


@dataclass(frozen=True)
class EventContext:
    """Sự kiện đang chạy (ACTIVE_EVENT_ID) và những gì luật cần từ nó."""
    event_id: str
    start_ms: int     # admission_start, epoch ms
    end_ms: int       # admission_end, epoch ms
    gate_count: int   # N = số cổng sự kiện mở (đếm từ event_gate)


# ---------- Đổi giờ ----------
def wall_ms_to_epoch_ms(wall_ms):
    """Số ms của 'giờ Việt Nam' đọc từ DATETIME2 (không có múi giờ) -> epoch ms."""
    return None if wall_ms is None else int(wall_ms) - VN_OFFSET_MS


def epoch_ms_to_vn_iso(ms):
    """epoch ms -> '2026-12-12T19:00:01.000' (giờ Việt Nam), dạng SQL Server đọc được cho DATETIME2(3)."""
    if ms is None:
        return None
    dt = datetime(1970, 1, 1) + timedelta(milliseconds=int(ms) + VN_OFFSET_MS)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}"


# ---------- Luật Silver ----------
def compute_silver(events: DataFrame, tickets: DataFrame, valid_scans: DataFrame,
                   wrong_gates: DataFrame, travel: DataFrame, ctx: EventContext) -> DataFrame:
    """Tính kết quả cho mọi lượt quét trong một micro-batch.

    events      : scan_event_id, raw_qr_payload, ticket_id, decode_error, gate_id, scanner_id,
                  operator_id, scanned_ms, received_ms, kafka_partition, kafka_offset
    tickets     : vé tra được trong DB (TICKET_SCHEMA), trạng thái TRƯỚC batch này
    valid_scans : lượt VALID đã có trong DB của các vé đó, tối đa 1 dòng mỗi vé (VALID_SCAN_SCHEMA)
    wrong_gates : các cổng mà vé đã từng bị WRONG_GATE trong DB (WRONG_GATE_SCHEMA)
    travel      : bảng gate_travel_time (TRAVEL_SCHEMA)

    Nhiều lượt quét của cùng một vé trong một batch được xử lý tuần tự theo received_at (hòa thì
    theo partition, offset của Kafka): lượt sau thấy trạng thái mà lượt trước để lại.

    Viết thành 6 bước `select`, mỗi bước thêm một nhóm cột, vì cột của bước sau dùng hàm cửa sổ
    tính trên cột của bước trước (Spark không cho lồng hàm cửa sổ). Gom như vậy ít lần phân tích
    plan hơn một chuỗi `withColumn`.
    """
    col = F.col
    # Trạng thái mỗi vé trước batch: dòng vé + lượt VALID đã có + các cổng sai đã có
    wg = (wrong_gates.groupBy("ticket_id").agg(F.collect_set("gate_id").alias("wg0"))
          .withColumnRenamed("ticket_id", "w_tid"))
    vs = valid_scans.select(col("ticket_id").alias("p_tid"), col("scan_event_id").alias("p0_id"),
                            col("gate_id").alias("p0_gate"), col("received_ms").alias("p0_ms"))
    state = (tickets.join(vs, col("ticket_id") == col("p_tid"), "left")
             .join(wg, col("ticket_id") == col("w_tid"), "left")
             .select(col("ticket_id").alias("t_id"), col("event_id").alias("t_event_id"),
                     col("assigned_gate_id").alias("t_gate"), col("ticket_status").alias("status0"),
                     "p0_id", "p0_gate", "p0_ms", "wg0"))
    tr = travel.select(col("gate_id_1").alias("tr_from"), col("gate_id_2").alias("tr_to"),
                       col("min_travel_time_ms").alias("tr_ms"))

    by_ticket = Window.partitionBy("tid")
    in_order = by_ticket.orderBy("received_ms", "kafka_partition", "kafka_offset", "scan_event_id")
    upto_here = in_order.rowsBetween(Window.unboundedPreceding, Window.currentRow)
    s0 = col("status0")
    already_in = s0.isin(VALID_ENTRY, FLAGGED_FRAUD)  # đã vào từ batch trước

    # (1) Bước 1 của file 07: tra vé. So khớp mã vé PHÂN BIỆT hoa thường (DB dùng collation CI nên
    #     'tk001' vẫn tìm ra 'TK001'; ở đây không coi là khớp). QR hỏng thì không tra.
    #     tid = mã vé sẽ ghi vào scan_event.ticket_id, NULL khi INVALID (file 13 mục C.2).
    found = col("t_id").isNotNull() & (col("t_event_id") == F.lit(ctx.event_id))
    df = (events.join(F.broadcast(state), (~col("decode_error")) & (col("ticket_id") == col("t_id")), "left")
          .select("*", F.when(found, col("t_id")).alias("tid")))

    # (2) Thứ tự trong batch, còn giờ nhận khách không, đúng cổng không
    df = df.select(
        "*",
        F.row_number().over(in_order).alias("rn"),
        ((col("received_ms") >= F.lit(ctx.start_ms)) & (col("received_ms") < F.lit(ctx.end_ms))).alias("in_window"),
        (col("t_gate").isNull() | (col("gate_id") == col("t_gate"))).alias("gate_ok"))

    # (3) Lượt đầu tiên trong batch đủ điều kiện vào (vé UNUSED, còn giờ, đúng cổng) là lượt VALID.
    #     Trước lượt đó vé vẫn UNUSED (EXPIRED/WRONG_GATE không đổi trạng thái), sau đó vé đã vào.
    can_enter = (s0 == UNUSED) & col("in_window") & col("gate_ok")
    df = df.select("*", F.min(F.when(can_enter, col("rn"))).over(by_ticket).alias("fv"))

    # (4) Thứ tự ưu tiên của file 07, dừng ở bước đầu tiên khớp; trạng thái vé ngay trước lượt này
    is_entry = col("rn") == col("fv")
    entered_earlier = col("fv").isNotNull() & (col("rn") > col("fv"))  # đã vào ở lượt trước, cùng batch
    df = df.select(
        "*",
        F.max(F.when(is_entry, col("scan_event_id"))).over(by_ticket).alias("bv_id"),
        F.max(F.when(is_entry, col("gate_id"))).over(by_ticket).alias("bv_gate"),
        F.max(F.when(is_entry, col("received_ms"))).over(by_ticket).alias("bv_ms"),
        (F.when(col("tid").isNull(), INVALID)                              # 1
         .when(s0 == CANCELLED, CANCELLED)                                 # 2
         .when(already_in | entered_earlier, USED)                         # 3
         .when((s0 == EXPIRED) | ~col("in_window"), EXPIRED)               # 4
         .when(~col("gate_ok"), WRONG_GATE)                                # 5
         .otherwise(VALID)).alias("scan_result"),                          # 6
        (F.when(col("tid").isNull(), F.lit(None).cast("string"))
         .when(already_in, F.when(col("rn") == 1, s0).otherwise(F.lit(FLAGGED_FRAUD)))
         .when(s0 != UNUSED, s0)                                           # CANCELLED, EXPIRED
         .when(col("fv").isNull() | (col("rn") <= col("fv")), F.lit(UNUSED))
         .when(col("rn") == col("fv") + 1, F.lit(VALID_ENTRY))
         .otherwise(F.lit(FLAGGED_FRAUD))).alias("ticket_status_before"))

    # (5) Trạng thái sau; lượt VALID trước đó (chỉ cho USED: ở DB nếu vé đã vào từ batch trước, ở
    #     batch nếu không); số cổng SAI khác nhau lũy kế tới lượt này (cổng sai ở DB + trong batch),
    #     không bao giờ tính cổng được gán của vé (phòng khi admin đổi cổng gán giữa chừng).
    res = col("scan_result")
    is_used = res == USED
    wrong_so_far = F.collect_list(F.when(res == WRONG_GATE, col("gate_id"))).over(upto_here)
    seen = F.array_except(
        F.array_distinct(F.concat(F.coalesce(col("wg0"), F.array().cast("array<string>")), wrong_so_far)),
        F.array(col("t_gate")))
    df = df.select(
        "*",
        (F.when(res == VALID, F.lit(VALID_ENTRY)).when(is_used, F.lit(FLAGGED_FRAUD))
         .otherwise(col("ticket_status_before"))).alias("ticket_status_after"),
        F.when(is_used, F.when(already_in, col("p0_id")).otherwise(col("bv_id"))).alias("previous_scan_event_id"),
        F.when(is_used, F.when(already_in, col("p0_gate")).otherwise(col("bv_gate"))).alias("previous_scan_gate_id"),
        F.when(is_used, F.when(already_in, col("p0_ms")).otherwise(col("bv_ms"))).alias("prev_ms"),
        F.when(res == WRONG_GATE, F.size(seen)).cast("int").alias("distinct_wrong_gate_count"),
        (col("rn") == F.max("rn").over(by_ticket)).alias("is_last_of_ticket"))

    # (6) Thời gian đi bộ, khoảng cách hai lần quét, mức và mã cảnh báo.
    #     Khoảng cách theo received_at (giờ server), không dùng scanned_at (file 09, R4). Lấy trị tuyệt
    #     đối phòng khi hai lượt cùng vé tới Kafka ngược thứ tự received_at ở hai batch khác nhau.
    #     Kiểm R4 trước R3: nhỏ hơn THẬT SỰ thời gian đi bộ mới là IMPOSSIBLE_TRAVEL.
    time_since = F.when(is_used, F.least(F.abs(col("received_ms") - col("prev_ms")), F.lit(INT_MAX))).cast("int")
    min_travel = F.when(is_used & (col("previous_scan_gate_id") != col("gate_id")), col("tr_ms")).cast("int")
    impossible = min_travel.isNotNull() & (time_since < min_travel)
    code = (F.when(res == INVALID, INVALID_QR)
            .when(res == CANCELLED, REVOKED_TICKET)
            .when(is_used, F.when(impossible, IMPOSSIBLE_TRAVEL).otherwise(DUPLICATE_SCAN))
            .when(res == WRONG_GATE,
                  F.when(col("distinct_wrong_gate_count") >= F.lit(ctx.gate_count - 1), WRONG_GATE_FRAUD)
                  .otherwise(WRONG_GATE_WARNING)))
    level = F.when(code.isNull(), NONE).when(code == WRONG_GATE_WARNING, WARNING).otherwise(FRAUD)
    # Vé đã vào nhưng DB không còn lượt VALID nào để trỏ về (CK_scan_event_used sẽ từ chối):
    # không ghi Silver, đẩy sang DLQ.
    problem = F.when(is_used & col("previous_scan_event_id").isNull(), F.lit(INCONSISTENT_TICKET_STATE))

    df = df.join(F.broadcast(tr), (col("previous_scan_gate_id") == col("tr_from"))
                 & (col("gate_id") == col("tr_to")), "left")
    return df.select(
        "scan_event_id",
        col("tid").alias("ticket_id"),
        "scanner_id", "gate_id", "operator_id", "previous_scan_event_id",
        "raw_qr_payload", "decode_error", "scanned_ms", "received_ms",
        "ticket_status_before", "ticket_status_after", "scan_result",
        level.alias("alert_level"), code.alias("alert_code"),
        "previous_scan_gate_id",
        time_since.alias("time_since_previous_scan_ms"),
        min_travel.alias("min_travel_time_ms"),
        F.when(col("tid").isNotNull(), col("t_gate")).alias("ticket_assigned_gate_id"),
        "distinct_wrong_gate_count",
        # cột phụ, không ghi DB
        s0.alias("ticket_status_initial"),
        "is_last_of_ticket",
        problem.alias("problem"),
    )


# ---------- Từ kết quả Spark ra các dòng cần ghi ----------
def build_writes(rows, now_ms):
    """rows: kết quả compute_silver() đã collect. Trả (scan_rows, ticket_updates, rejected).

    scan_rows      : list dict đúng 21 cột của scan_event, giờ đã đổi sang chuỗi giờ Việt Nam
    ticket_updates : list dict {ticket_id, status_before, status_after}, mỗi vé tối đa một dòng
    rejected       : list (scan_event_id, lý do) - không ghi Silver
    """
    bad_tickets = {r["ticket_id"] for r in rows if r["problem"] and r["ticket_id"]}
    scan_rows, ticket_updates, rejected = [], [], []
    for r in rows:
        if r["problem"] or (r["ticket_id"] is not None and r["ticket_id"] in bad_tickets):
            rejected.append((r["scan_event_id"], r["problem"] or INCONSISTENT_TICKET_STATE))
            continue
        # processing_ts >= received_at (CK_scan_event_ts). max() chỉ để chống lệch đồng hồ vài ms
        # giữa API và Spark; bản tin có received_at ở tương lai xa đã bị loại trước đó.
        processing_ms = max(int(now_ms), int(r["received_ms"]))
        row = {c: r[c] for c in SCAN_EVENT_COLUMNS
               if c not in ("scanned_at", "received_at", "processing_ts")}
        row["scanned_at"] = epoch_ms_to_vn_iso(r["scanned_ms"])
        row["received_at"] = epoch_ms_to_vn_iso(r["received_ms"])
        row["processing_ts"] = epoch_ms_to_vn_iso(processing_ms)
        scan_rows.append(row)
        if (r["ticket_id"] is not None and r["is_last_of_ticket"]
                and r["ticket_status_after"] != r["ticket_status_initial"]):
            ticket_updates.append({"ticket_id": r["ticket_id"],
                                   "status_before": r["ticket_status_initial"],
                                   "status_after": r["ticket_status_after"]})
    return scan_rows, ticket_updates, rejected
