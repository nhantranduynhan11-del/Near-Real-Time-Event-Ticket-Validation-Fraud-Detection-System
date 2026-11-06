"""spark/silver_scan_events.py - Micro-batch Silver: Kafka -> luật nghiệp vụ -> SQL Server (Role B).

Mỗi micro-batch (foreachBatch) làm theo thứ tự:

1. Tách JSON (dùng chung parse_events của job Bronze). Bản tin hỏng ở mức Bronze đã do query
   Bronze đẩy sang DLQ nên ở đây bỏ qua. Bản tin thiếu thứ mà Silver bắt buộc (vd scanned_at
   hỏng, scan_event_id không phải UUID) thì đẩy sang DLQ kèm lý do.
2. MỞ MỘT GIAO DỊCH SQL Server:
   a. Bỏ những scan_event_id đã có trong scan_event (Spark chạy lại batch sau khi bị tắt).
   b. Đọc bảng tham chiếu: sự kiện đang chạy, số cổng, máy quét, nhân viên, thời gian đi bộ.
   c. Khóa (UPDLOCK) và đọc các vé có trong batch, cùng lượt VALID và các cổng sai đã có của chúng.
   d. Spark tính kết quả (silver_logic.compute_silver).
   e. Ghi scan_event (21 cột), fraud_alert, đổi ticket_status. COMMIT.
3. Đẩy các bản tin bị loại sang DLQ.
4. Gọi refresh_gold() của Role A (file 13, phần E).

Vì 2a-2e nằm trong một giao dịch nên tắt Spark ở bất kỳ đâu rồi bật lại cũng không trùng, không
mất: batch chưa commit thì làm lại từ đầu, batch đã commit thì 2a bỏ qua hết.
"""
import json
import time
from dataclasses import dataclass, field

from py4j.protocol import Py4JJavaError
from pyspark.sql import DataFrame
from pyspark.sql import functions as F

from bronze_scan_events import non_empty, parse_events
from silver_logic import (
    TICKET_SCHEMA, TRAVEL_SCHEMA, VALID_SCAN_SCHEMA, WRONG_GATE_SCHEMA, EventContext,
    build_writes, compute_silver, wall_ms_to_epoch_ms)
from sqlserver import DATA_ERRORS, TRANSIENT_ERRORS, is_connection_error, sql_error_code

UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
MAX_PAYLOAD = 512                 # scan_event.raw_qr_payload NVARCHAR(512)
MAX_ID_LEN = 20                   # mọi cột mã NVARCHAR(20)
FUTURE_TOLERANCE_MS = 2000        # received_at vượt giờ Spark quá mức này là bản tin sai giờ

# ---------- SQL ----------
# Mốc 0 để đổi DATETIME2 (giờ Việt Nam, không múi giờ) ra số ms, tránh mọi rắc rối định dạng chuỗi giờ.
_EPOCH = "CAST('1970-01-01T00:00:00' AS DATETIME2(3))"

SQL_EVENT = f"""
SELECT (
    SELECT e.event_id,
           DATEDIFF_BIG(MILLISECOND, {_EPOCH}, e.admission_start) AS start_wall_ms,
           DATEDIFF_BIG(MILLISECOND, {_EPOCH}, e.admission_end)   AS end_wall_ms,
           (SELECT COUNT(*) FROM dbo.event_gate AS eg WHERE eg.event_id = e.event_id) AS gate_count
    FROM dbo.[event] AS e
    WHERE e.event_id = ?
    FOR JSON PATH
) AS ev,
(SELECT g.gate_id_1, g.gate_id_2, g.min_travel_time_ms FROM dbo.gate_travel_time AS g FOR JSON PATH) AS travel,
(SELECT s.scanner_id, s.gate_id FROM dbo.scanner AS s FOR JSON PATH) AS scanners,
(SELECT u.user_id FROM dbo.app_user AS u WHERE u.role = N'GATE_OPERATOR' FOR JSON PATH) AS operators;
"""

SQL_EXISTING = """
SELECT (
    SELECT LOWER(CONVERT(NVARCHAR(36), s.scan_event_id)) AS id
    FROM dbo.scan_event AS s
    WHERE s.scan_event_id IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER, j.[value]) FROM OPENJSON(?) AS j)
    FOR JSON PATH
) AS ids;
"""

# UPDLOCK + HOLDLOCK: giữ khóa các vé này tới khi COMMIT. API thu hồi vé cùng lúc sẽ phải chờ,
# nên không có chuyện Spark cho vào một vé vừa bị thu hồi (file 15 mục 3.5).
SQL_TICKETS = """
SELECT (
    SELECT t.ticket_id, t.event_id, t.assigned_gate_id, t.ticket_status
    FROM dbo.ticket AS t WITH (UPDLOCK, HOLDLOCK)
    WHERE t.ticket_id IN (SELECT CAST(j.[value] AS NVARCHAR(20)) FROM OPENJSON(?) AS j)
    FOR JSON PATH, INCLUDE_NULL_VALUES
) AS tickets;
"""

SQL_HISTORY = f"""
SELECT (
    SELECT s.ticket_id,
           LOWER(CONVERT(NVARCHAR(36), s.scan_event_id)) AS scan_event_id,
           s.gate_id, s.scan_result,
           DATEDIFF_BIG(MILLISECOND, {_EPOCH}, s.received_at) AS received_wall_ms
    FROM dbo.scan_event AS s
    WHERE s.ticket_id IN (SELECT CAST(j.[value] AS NVARCHAR(20)) FROM OPENJSON(?) AS j)
      AND s.scan_result IN (N'VALID', N'WRONG_GATE')
    FOR JSON PATH
) AS history;
"""

_SCAN_JSON_COLUMNS = """
    scan_event_id               UNIQUEIDENTIFIER,
    ticket_id                   NVARCHAR(20),
    scanner_id                  NVARCHAR(20),
    gate_id                     NVARCHAR(20),
    operator_id                 NVARCHAR(20),
    previous_scan_event_id      UNIQUEIDENTIFIER,
    raw_qr_payload              NVARCHAR(512),
    decode_error                BIT,
    scanned_at                  DATETIME2(3),
    received_at                 DATETIME2(3),
    processing_ts               DATETIME2(3),
    ticket_status_before        NVARCHAR(20),
    ticket_status_after         NVARCHAR(20),
    scan_result                 NVARCHAR(20),
    alert_level                 NVARCHAR(20),
    alert_code                  NVARCHAR(20),
    previous_scan_gate_id       NVARCHAR(20),
    time_since_previous_scan_ms INT,
    min_travel_time_ms          INT,
    ticket_assigned_gate_id     NVARCHAR(20),
    distinct_wrong_gate_count   INT
"""
_SCAN_COLUMN_LIST = """scan_event_id, ticket_id, scanner_id, gate_id, operator_id, previous_scan_event_id,
    raw_qr_payload, decode_error, scanned_at, received_at,
    processing_ts, ticket_status_before, ticket_status_after, scan_result, alert_level, alert_code,
    previous_scan_gate_id, time_since_previous_scan_ms, min_travel_time_ms,
    ticket_assigned_gate_id, distinct_wrong_gate_count"""

# Đúng 21 cột (file 13 mục C.1). Hai lượt: lượt USED trỏ (khóa ngoại tự tham chiếu) tới lượt VALID
# có thể nằm cùng batch, nên ghi các dòng khác USED trước.
SQL_INSERT_SCAN = f"""
INSERT INTO dbo.scan_event ({_SCAN_COLUMN_LIST})
SELECT {_SCAN_COLUMN_LIST}
FROM OPENJSON(?) WITH ({_SCAN_JSON_COLUMNS}) AS j
WHERE j.scan_result {{op}} N'USED';
"""
SQL_INSERT_SCAN_NOT_USED = SQL_INSERT_SCAN.replace("{op}", "<>")
SQL_INSERT_SCAN_USED = SQL_INSERT_SCAN.replace("{op}", "=")

# created_at lấy mặc định của bảng (giờ Việt Nam của SQL Server)
SQL_INSERT_ALERT = """
INSERT INTO dbo.fraud_alert (scan_event_id, alert_code, alert_level)
SELECT j.scan_event_id, j.alert_code, j.alert_level
FROM OPENJSON(?) WITH (scan_event_id UNIQUEIDENTIFIER, alert_code NVARCHAR(20), alert_level NVARCHAR(20)) AS j
WHERE j.alert_level <> N'NONE';
"""

# Chỉ đổi khi vé vẫn đúng trạng thái đã đọc (đã giữ khóa nên luôn khớp; sai là có lỗi logic)
SQL_UPDATE_TICKETS = """
UPDATE t SET t.ticket_status = j.status_after
FROM dbo.ticket AS t
JOIN OPENJSON(?) WITH (ticket_id NVARCHAR(20), status_before NVARCHAR(20), status_after NVARCHAR(20)) AS j
  ON j.ticket_id = t.ticket_id AND j.status_before = t.ticket_status;
"""


# ---------- Bước 1: tách và kiểm tra bản tin ----------
def prepare_events(batch_df: DataFrame, now_ms: int) -> DataFrame:
    """Bản tin hợp lệ ở mức Bronze -> các cột Silver cần, cộng cột `reason` (lý do loại, hoặc NULL)."""
    p = parse_events(batch_df).where(F.col("is_valid"))
    ev = p.select(
        F.lower(F.trim(F.col("scan_event_id"))).alias("scan_event_id"),
        "raw_qr_payload", "ticket_id", "decode_error", "gate_id", "scanner_id",
        F.when(non_empty("operator_id"), F.col("operator_id")).alias("operator_id"),
        F.unix_millis(F.col("scanned_ts")).alias("scanned_ms"),
        F.unix_millis(F.col("received_ts")).alias("received_ms"),
        F.col("partition").alias("kafka_partition"),
        F.col("offset").alias("kafka_offset"),
        "key", "raw_json",
    )
    reason = (
        F.when(~F.col("scan_event_id").rlike(UUID_RE), "BAD_SCAN_EVENT_ID")
        .when(F.col("decode_error").isNull(), "MISSING_DECODE_ERROR")
        .when(~non_empty("gate_id") | ~non_empty("scanner_id"), "MISSING_GATE_OR_SCANNER")
        .when((F.length("gate_id") > MAX_ID_LEN) | (F.length("scanner_id") > MAX_ID_LEN)
              | (F.coalesce(F.length("operator_id"), F.lit(0)) > MAX_ID_LEN), "ID_TOO_LONG")
        .when(F.col("scanned_ms").isNull(), "BAD_SCANNED_AT")
        .when(F.length("raw_qr_payload") > MAX_PAYLOAD, "PAYLOAD_TOO_LONG")
        .when(F.col("received_ms") > F.lit(now_ms + FUTURE_TOLERANCE_MS), "RECEIVED_AT_IN_FUTURE"))
    return ev.withColumn("reason", reason).dropDuplicates(["scan_event_id"])


# ---------- Kết quả một batch ----------
@dataclass
class BatchReport:
    written: int = 0
    skipped: int = 0
    by_result: dict = field(default_factory=dict)
    ticket_updates: int = 0
    rejected: list = field(default_factory=list)  # (scan_event_id, reason)
    timings: dict = field(default_factory=dict)   # bước -> giây, để thấy chỗ chậm trong log

    def tick(self, step, since):
        now = time.time()
        self.timings[step] = self.timings.get(step, 0.0) + (now - since)
        return now

    def merge(self, other):
        self.written += other.written
        self.skipped += other.skipped
        self.ticket_updates += other.ticket_updates
        self.rejected.extend(other.rejected)
        for k, v in other.by_result.items():
            self.by_result[k] = self.by_result.get(k, 0) + v
        for k, v in other.timings.items():
            self.timings[k] = self.timings.get(k, 0.0) + v


class SilverJob:
    """Giữ kết nối DB và cấu hình; `handle_batch` là hàm Spark gọi cho mỗi micro-batch."""

    def __init__(self, spark, db, active_event_id, bootstrap, dlq_topic, gold_hook=None,
                 max_attempts=3):
        self.spark = spark
        self.db = db
        self.active_event_id = active_event_id
        self.bootstrap = bootstrap
        self.dlq_topic = dlq_topic
        self.gold_hook = gold_hook
        self.max_attempts = max_attempts
        self._gold_pending = gold_hook is not None

    # ---------- Spark gọi hàm này ----------
    def handle_batch(self, batch_df: DataFrame, batch_id: int):
        if batch_df.isEmpty():
            if self._gold_pending:  # lần trước Gold lỗi, hoặc vừa khởi động: thử lại
                self.refresh_gold(batch_id)
            return
        started = time.time()
        events = prepare_events(batch_df, int(started * 1000)).persist()
        try:
            report = self._process_with_retry(events)
            self._send_to_dlq(events, report.rejected)
        finally:
            events.unpersist()
        self._gold_pending = self.gold_hook is not None
        self.refresh_gold(batch_id)
        results = ", ".join(f"{k} {v}" for k, v in sorted(report.by_result.items())) or "-"
        steps = ", ".join(f"{k} {v:.2f}s" for k, v in report.timings.items())
        print(f"[silver] batch {batch_id}: {report.written} lượt -> Silver ({results}); "
              f"{report.ticket_updates} vé đổi trạng thái; {report.skipped} đã có (bỏ qua); "
              f"{len(report.rejected)} -> DLQ; {time.time() - started:.2f}s ({steps})", flush=True)

    def warm_up(self):
        """Chạy thử compute_silver trên vài dòng giả lúc khởi động. Lần chạy đầu của JVM chậm hơn
        hẳn (nạp lớp, JIT), nên làm trước để lượt quét thật đầu tiên không bị trả 202."""
        started = time.time()
        s = self.spark
        event_schema = ("scan_event_id string, raw_qr_payload string, ticket_id string, "
                        "decode_error boolean, gate_id string, scanner_id string, operator_id string, "
                        "scanned_ms long, received_ms long, kafka_partition int, kafka_offset long")
        rows = [("00000000-0000-4000-8000-00000000000%d" % i, "x", "WARMUP", False, "G1", "S1", None,
                 0, i, 0, i) for i in range(1, 4)]
        compute_silver(
            s.createDataFrame(rows, event_schema),
            s.createDataFrame([("WARMUP", self.active_event_id, None, "UNUSED")], TICKET_SCHEMA),
            s.createDataFrame([], VALID_SCAN_SCHEMA), s.createDataFrame([], WRONG_GATE_SCHEMA),
            s.createDataFrame([("G1", "G2", 1000)], TRAVEL_SCHEMA),
            EventContext(self.active_event_id, 0, 10, 2)).collect()
        print(f"[silver] làm nóng xong ({time.time() - started:.1f}s)", flush=True)

    def refresh_gold(self, batch_id=None):
        """Gọi module Gold của A. Lỗi thì ghi log, để batch sau thử lại (Gold tính lại được)."""
        if self.gold_hook is None:
            return
        try:
            self.gold_hook(self.db, self.active_event_id, batch_id)
            self._gold_pending = False
        except Exception as exc:  # noqa: BLE001 - Gold lỗi không được làm dừng Silver
            print(f"[silver] refresh_gold lỗi, sẽ thử lại ở batch sau: {exc}", flush=True)
            self._gold_pending = True

    # ---------- Thử lại và cô lập bản tin độc ----------
    def _process_with_retry(self, events: DataFrame) -> BatchReport:
        for attempt in range(1, self.max_attempts + 1):
            try:
                return self._process(events)
            except Py4JJavaError as exc:
                code = sql_error_code(exc)
                if code in DATA_ERRORS:
                    print(f"[silver] lỗi dữ liệu SQL {code}, xử lý lại từng vé để cô lập bản tin hỏng",
                          flush=True)
                    return self._process_per_ticket(events)
                transient = code in TRANSIENT_ERRORS or is_connection_error(exc)
                if not transient or attempt == self.max_attempts:
                    raise
                print(f"[silver] lỗi tạm thời (SQL {code}), thử lại lần {attempt + 1}...", flush=True)
                self.db.close()
                time.sleep(attempt)
        raise RuntimeError("không tới được đây")

    def _process_per_ticket(self, events: DataFrame) -> BatchReport:
        """Mỗi vé (hoặc mỗi lượt quét không có mã vé) một giao dịch riêng. Nhóm nào lỗi thì vào DLQ."""
        group = F.when(~F.col("decode_error") & F.col("ticket_id").isNotNull(),
                       F.concat(F.lit("T:"), F.col("ticket_id"))
                       ).otherwise(F.concat(F.lit("S:"), F.col("scan_event_id")))
        keyed = events.withColumn("_group", group)
        total = BatchReport()
        for (g,) in keyed.select("_group").distinct().collect():
            sub = keyed.where(F.col("_group") == g).drop("_group")
            try:
                total.merge(self._process(sub))
            except Py4JJavaError as exc:
                code = sql_error_code(exc)
                if code not in DATA_ERRORS:
                    raise
                ids = [r.scan_event_id for r in sub.select("scan_event_id").collect()]
                total.rejected.extend((i, f"SQL_ERROR_{code}") for i in ids)
        return total

    # ---------- Một lần xử lý trong một giao dịch ----------
    def _process(self, events: DataFrame) -> BatchReport:
        spark, db = self.spark, self.db
        report = BatchReport()
        t = time.time()
        rows = events.select("scan_event_id", "ticket_id", "decode_error", "gate_id",
                             "scanner_id", "operator_id", "reason").collect()
        t = report.tick("kafka", t)
        for r in rows:
            if r.reason:
                report.rejected.append((r.scan_event_id, r.reason))
        candidates = [r for r in rows if not r.reason]
        if not candidates:
            return report

        with db.transaction():
            # a. bỏ lượt quét đã ghi (chạy lại batch)
            (existing,) = db.query_json(SQL_EXISTING, json.dumps([r.scan_event_id for r in candidates]))
            existing = {e["id"] for e in existing}

            # b. bảng tham chiếu
            ctx, travel, scanner_pairs, operators = self._load_reference()

            accepted = []
            for r in candidates:
                if r.scan_event_id in existing:
                    report.skipped += 1
                elif (r.scanner_id, r.gate_id) not in scanner_pairs:
                    report.rejected.append((r.scan_event_id, "UNKNOWN_SCANNER_GATE"))
                elif r.operator_id is not None and r.operator_id not in operators:
                    report.rejected.append((r.scan_event_id, "UNKNOWN_OPERATOR"))
                else:
                    accepted.append(r)
            if not accepted:
                return report

            # c. vé trong batch (khóa lại), lượt VALID và cổng sai đã có
            ticket_ids = sorted({r.ticket_id for r in accepted
                                 if r.decode_error is False and r.ticket_id
                                 and len(r.ticket_id) <= MAX_ID_LEN})
            tickets, history = [], []
            if ticket_ids:
                ids_json = json.dumps(ticket_ids)
                (tickets,) = db.query_json(SQL_TICKETS, ids_json)
                (history,) = db.query_json(SQL_HISTORY, ids_json)
            valid_scans, wrong_gates = _split_history(history)
            t = report.tick("đọc DB", t)

            # d. Spark tính kết quả
            acc_ids = spark.createDataFrame([(r.scan_event_id,) for r in accepted], "acc_id string")
            batch = events.join(F.broadcast(acc_ids), F.col("scan_event_id") == F.col("acc_id"),
                                "left_semi")
            out = compute_silver(
                batch,
                spark.createDataFrame(
                    [(t["ticket_id"], t["event_id"], t.get("assigned_gate_id"), t["ticket_status"])
                     for t in tickets], TICKET_SCHEMA),
                spark.createDataFrame(valid_scans, VALID_SCAN_SCHEMA),
                spark.createDataFrame(wrong_gates, WRONG_GATE_SCHEMA),
                spark.createDataFrame(travel, TRAVEL_SCHEMA),
                ctx)
            out_rows = [r.asDict() for r in out.collect()]
            t = report.tick("tính", t)

            # e. ghi
            scan_rows, updates, problems = build_writes(out_rows, int(time.time() * 1000))
            report.rejected.extend(problems)
            if scan_rows:
                payload = json.dumps(scan_rows, ensure_ascii=False)
                n = db.execute(SQL_INSERT_SCAN_NOT_USED, payload)
                n += db.execute(SQL_INSERT_SCAN_USED, payload)
                db.execute(SQL_INSERT_ALERT, payload)
                if n != len(scan_rows):
                    raise RuntimeError(f"ghi scan_event được {n}/{len(scan_rows)} dòng")
            if updates:
                n = db.execute(SQL_UPDATE_TICKETS, json.dumps(updates))
                if n != len(updates):
                    raise RuntimeError(f"đổi trạng thái được {n}/{len(updates)} vé (vé bị đổi giữa chừng?)")
            report.written = len(scan_rows)
            report.ticket_updates = len(updates)
            for row in scan_rows:
                report.by_result[row["scan_result"]] = report.by_result.get(row["scan_result"], 0) + 1
        report.tick("ghi DB", t)  # gồm cả COMMIT
        return report

    def _load_reference(self):
        ev, travel, scanners, operators = self.db.query_json(SQL_EVENT, self.active_event_id)
        if not ev:
            raise RuntimeError(f"Không có sự kiện ACTIVE_EVENT_ID={self.active_event_id} trong bảng event")
        e = ev[0]
        ctx = EventContext(event_id=e["event_id"],
                           start_ms=wall_ms_to_epoch_ms(e["start_wall_ms"]),
                           end_ms=wall_ms_to_epoch_ms(e["end_wall_ms"]),
                           gate_count=int(e["gate_count"]))
        travel_rows = [(t["gate_id_1"], t["gate_id_2"], int(t["min_travel_time_ms"])) for t in travel]
        scanner_pairs = {(s["scanner_id"], s["gate_id"]) for s in scanners}
        operator_ids = {u["user_id"] for u in operators}
        return ctx, travel_rows, scanner_pairs, operator_ids

    # ---------- DLQ ----------
    def _send_to_dlq(self, events: DataFrame, rejected):
        """Gửi nguyên văn bản tin bị loại sang topic DLQ, kèm header dlq_stage và dlq_reason."""
        if not rejected:
            return
        reasons = self.spark.createDataFrame(rejected, "rej_id string, rej_reason string")
        dlq = (events.join(reasons, F.col("scan_event_id") == F.col("rej_id"))
               .select(F.col("key"),
                       F.coalesce(F.col("raw_json"), F.lit("")).alias("value"),
                       F.array(
                           F.struct(F.lit("dlq_stage").alias("key"),
                                    F.lit("silver").cast("binary").alias("value")),
                           F.struct(F.lit("dlq_reason").alias("key"),
                                    F.col("rej_reason").cast("binary").alias("value")),
                       ).alias("headers")))
        (dlq.write.format("kafka")
         .option("kafka.bootstrap.servers", self.bootstrap)
         .option("topic", self.dlq_topic)
         .save())
        for scan_event_id, reason in rejected:
            print(f"[silver] -> DLQ {scan_event_id}: {reason}", flush=True)


def _split_history(history):
    """Lịch sử từ DB -> (lượt VALID sớm nhất mỗi vé, các cặp (vé, cổng sai))."""
    valid_by_ticket = {}
    wrong = set()
    for h in history:
        ms = wall_ms_to_epoch_ms(h["received_wall_ms"])
        if h["scan_result"] == "VALID":
            cur = valid_by_ticket.get(h["ticket_id"])
            if cur is None or ms < cur[3]:
                valid_by_ticket[h["ticket_id"]] = (h["ticket_id"], h["scan_event_id"], h["gate_id"], ms)
        else:
            wrong.add((h["ticket_id"], h["gate_id"]))
    return list(valid_by_ticket.values()), sorted(wrong)
