#!/usr/bin/env python3
"""spark/tests/test_silver_logic.py - Kiểm tra luật Silver mà KHÔNG cần Kafka hay SQL Server.

Dựng các DataFrame đầu vào bằng tay (dữ liệu mẫu của file 10), chạy silver_logic.compute_silver()
rồi so với kết quả mong đợi của file 06, 07, 09, 10.

Chạy (từ gốc repo, trong WSL):
    .venv/bin/python spark/tests/test_silver_logic.py
Mã thoát 0 khi mọi ca đạt.
"""
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pyspark.sql import SparkSession  # noqa: E402

from silver_logic import (  # noqa: E402
    TICKET_SCHEMA, TRAVEL_SCHEMA, VALID_SCAN_SCHEMA, WRONG_GATE_SCHEMA, EventContext,
    build_writes, compute_silver, epoch_ms_to_vn_iso)

VN = timezone(timedelta(hours=7))
EVENT_SCHEMA = ("scan_event_id string, raw_qr_payload string, ticket_id string, decode_error boolean, "
                "gate_id string, scanner_id string, operator_id string, scanned_ms long, received_ms long, "
                "kafka_partition int, kafka_offset long")


def ms(hhmmss, day=12):
    """'19:00:01' ngày demo 12/12/2026 (giờ VN) -> epoch ms. Có thể kèm '.mmm'."""
    t = datetime.strptime(hhmmss, "%H:%M:%S.%f" if "." in hhmmss else "%H:%M:%S")
    dt = datetime(2026, 12, day, t.hour, t.minute, t.second, t.microsecond, tzinfo=VN)
    return int(dt.timestamp() * 1000)


CTX = EventContext("EV001", ms("18:00:00"), ms("20:00:00"), gate_count=4)
SEED_TICKETS = {  # file 10, trạng thái ban đầu
    "TK001": ("EV001", "GATE_A", "UNUSED"),
    "TK002": ("EV001", "GATE_B", "UNUSED"),
    "TK003": ("EV001", "GATE_C", "CANCELLED"),
    "TK004": ("EV001", "GATE_B", "UNUSED"),
    "TK005": ("EV002", "GATE_A", "UNUSED"),
    "TK006": ("EV001", "GATE_A", "UNUSED"),
    "TK007": ("EV001", "GATE_C", "UNUSED"),
    "TK008": ("EV001", None, "UNUSED"),     # vé không giới hạn cổng (thêm để thử)
    "TK009": ("EV001", "GATE_A", "EXPIRED"),  # vé đã được tiến trình đóng cổng chuyển EXPIRED
    "TK010": ("EV001", "GATE_A", "UNUSED"),
}
TRAVEL = []
for (a, b), sec in {("GATE_A", "GATE_B"): 45, ("GATE_A", "GATE_C"): 90, ("GATE_A", "GATE_D"): 140,
                    ("GATE_B", "GATE_C"): 60, ("GATE_B", "GATE_D"): 100, ("GATE_C", "GATE_D"): 50}.items():
    TRAVEL += [(a, b, sec * 1000), (b, a, sec * 1000)]


class Scenario:
    def __init__(self, spark):
        self.spark = spark
        self.events = []
        self.status = {k: v[2] for k, v in SEED_TICKETS.items()}
        self.valid = []      # (ticket, scan_event_id, gate, received_ms) đã có trong DB
        self.wrong = []      # (ticket, gate) đã có trong DB
        self._offset = 0

    def scan(self, ticket, gate, at, decode_error=False, partition=0):
        sid = str(uuid.uuid4())
        self._offset += 1
        self.events.append((sid, f"{ticket}.sig", None if decode_error else ticket, decode_error,
                            gate, "SC_" + gate[-1] + "1", None, at, at, partition, self._offset))
        return sid

    def run(self):
        s = self.spark
        tickets = [(k, v[0], v[1], self.status[k]) for k, v in SEED_TICKETS.items()]
        out = compute_silver(
            s.createDataFrame(self.events, EVENT_SCHEMA),
            s.createDataFrame(tickets, TICKET_SCHEMA),
            s.createDataFrame(self.valid, VALID_SCAN_SCHEMA),
            s.createDataFrame(self.wrong, WRONG_GATE_SCHEMA),
            s.createDataFrame(TRAVEL, TRAVEL_SCHEMA),
            CTX)
        return {r["scan_event_id"]: r.asDict() for r in out.collect()}


failures = []


def check(name, row, **expected):
    bad = {k: (row.get(k), v) for k, v in expected.items() if row.get(k) != v}
    if bad:
        failures.append(name)
        print(f"[FAIL] {name}")
        for k, (got, want) in bad.items():
            print(f"         {k}: nhận {got!r}, mong đợi {want!r}")
    else:
        print(f"[ OK ] {name}")


def main():
    spark = (SparkSession.builder.master("local[2]").appName("test_silver_logic")
             .config("spark.sql.session.timeZone", "Asia/Ho_Chi_Minh")
             .config("spark.sql.shuffle.partitions", "2")
             .config("spark.ui.enabled", "false")
             .config("spark.ui.showConsoleProgress", "false")
             .config("spark.python.sql.dataFrameDebugging.enabled", "false")
             .getOrCreate())
    spark.sparkContext.setLogLevel("ERROR")
    try:
        run_all(spark)
    finally:
        spark.stop()
    print()
    if failures:
        print(f"KẾT QUẢ: {len(failures)} ca KHÔNG ĐẠT: {', '.join(failures)}")
        return 1
    print("KẾT QUẢ: mọi ca đạt.")
    return 0


def run_all(spark):
    print("== File 10: TC01-TC08 (mỗi ca dữ liệu ban đầu riêng) ==")
    # TC01 + TC02: vé sự kiện khác, rồi vé hợp lệ ngay sau trên cùng máy quét (cùng batch)
    sc = Scenario(spark)
    a = sc.scan("TK005", "GATE_A", ms("19:05:00"))
    b = sc.scan("TK006", "GATE_A", ms("19:05:02"))
    r = sc.run()
    check("TC01 vé EV002 -> INVALID", r[a], scan_result="INVALID", alert_level="FRAUD",
          alert_code="INVALID_QR", ticket_id=None, ticket_status_before=None, ticket_status_after=None)
    check("TC02 vé đúng sự kiện ngay sau -> VALID", r[b], scan_result="VALID", alert_level="NONE",
          alert_code=None, ticket_status_before="UNUSED", ticket_status_after="VALID_ENTRY")

    # TC03 + TC04
    sc = Scenario(spark)
    a = sc.scan("TK003", "GATE_C", ms("19:15:00"))
    b = sc.scan("TK007", "GATE_C", ms("19:15:03"))
    r = sc.run()
    check("TC03 vé đã thu hồi -> CANCELLED", r[a], scan_result="CANCELLED", alert_level="FRAUD",
          alert_code="REVOKED_TICKET", ticket_status_before="CANCELLED", ticket_status_after="CANCELLED")
    check("TC04 vé cùng đợt chưa thu hồi -> VALID", r[b], scan_result="VALID",
          ticket_status_after="VALID_ENTRY")

    # TC05: TK002 đã vào GATE_B 19:10:00 (batch trước), quét lại cùng cổng 19:40:00
    sc = Scenario(spark)
    sc.status["TK002"] = "VALID_ENTRY"
    sc.valid.append(("TK002", "00000000-0000-4000-8000-000000000002", "GATE_B", ms("19:10:00")))
    a = sc.scan("TK002", "GATE_B", ms("19:40:00"))
    r = sc.run()
    check("TC05 quét lại cùng cổng sau 30 phút -> USED/DUPLICATE_SCAN", r[a], scan_result="USED",
          alert_code="DUPLICATE_SCAN", ticket_status_before="VALID_ENTRY",
          ticket_status_after="FLAGGED_FRAUD", time_since_previous_scan_ms=1_800_000,
          min_travel_time_ms=None, previous_scan_gate_id="GATE_B",
          previous_scan_event_id="00000000-0000-4000-8000-000000000002")

    # TC06: TK002 vừa vào 19:10:00, TK004 cùng cổng 19:10:02
    sc = Scenario(spark)
    sc.status["TK002"] = "VALID_ENTRY"
    sc.valid.append(("TK002", "00000000-0000-4000-8000-000000000002", "GATE_B", ms("19:10:00")))
    a = sc.scan("TK004", "GATE_B", ms("19:10:02"))
    r = sc.run()
    check("TC06 vé khác cùng cổng cách 2 giây -> VALID", r[a], scan_result="VALID",
          ticket_status_after="VALID_ENTRY")

    # TC07 / TC08: TK001 đã vào GATE_A 19:00:01
    for name, at, code in [("TC07 GATE_D sau 3 giây -> IMPOSSIBLE_TRAVEL", "19:00:04", "IMPOSSIBLE_TRAVEL"),
                           ("TC08 GATE_D sau đúng 140 giây -> DUPLICATE_SCAN", "19:02:21", "DUPLICATE_SCAN")]:
        sc = Scenario(spark)
        sc.status["TK001"] = "VALID_ENTRY"
        sc.valid.append(("TK001", "00000000-0000-4000-8000-000000000001", "GATE_A", ms("19:00:01")))
        a = sc.scan("TK001", "GATE_D", ms(at))
        r = sc.run()
        check(name, r[a], scan_result="USED", alert_level="FRAUD", alert_code=code,
              previous_scan_gate_id="GATE_A", min_travel_time_ms=140_000,
              time_since_previous_scan_ms=ms(at) - ms("19:00:01"),
              ticket_status_before="VALID_ENTRY", ticket_status_after="FLAGGED_FRAUD")

    print("\n== Bước 1 (INVALID) ==")
    sc = Scenario(spark)
    a = sc.scan("FAKE_TK999", "GATE_A", ms("19:00:00"))
    b = sc.scan("ignored", "GATE_A", ms("19:00:00"), decode_error=True)
    c = sc.scan("tk001", "GATE_A", ms("19:00:00"))
    r = sc.run()
    check("Vé giả -> INVALID, ticket_id NULL", r[a], scan_result="INVALID", alert_code="INVALID_QR",
          ticket_id=None, ticket_assigned_gate_id=None)
    check("QR hỏng hoặc sai chữ ký (API đặt decode_error) -> INVALID", r[b], scan_result="INVALID",
          ticket_id=None, alert_code="INVALID_QR")
    check("Mã vé chữ thường 'tk001' -> INVALID", r[c], scan_result="INVALID", ticket_id=None)

    print("\n== Thứ tự ưu tiên bước 2-6 ==")
    sc = Scenario(spark)
    sc.status["TK002"] = "VALID_ENTRY"
    sc.valid.append(("TK002", "00000000-0000-4000-8000-000000000002", "GATE_B", ms("19:10:00")))
    a = sc.scan("TK003", "GATE_C", ms("21:00:00"))   # CANCELLED sau giờ
    b = sc.scan("TK002", "GATE_B", ms("21:00:00"))   # đã vào, quét sau giờ
    c = sc.scan("TK006", "GATE_B", ms("20:30:00"))   # UNUSED, sai cổng, hết giờ
    d = sc.scan("TK004", "GATE_B", ms("17:59:59"))   # trước giờ mở
    e = sc.scan("TK009", "GATE_A", ms("19:00:00"))   # trạng thái EXPIRED, đúng cổng
    f = sc.scan("TK007", "GATE_A", ms("19:00:00"))   # UNUSED, sai cổng, còn giờ
    g = sc.scan("TK008", "GATE_D", ms("19:00:00"))   # vé không giới hạn cổng
    h = sc.scan("TK001", "GATE_A", ms("20:00:00"))   # đúng 20:00:00 -> đã hết giờ
    i = sc.scan("TK010", "GATE_A", ms("18:00:00"))   # đúng 18:00:00 -> trong giờ
    r = sc.run()
    check("CANCELLED quét sau giờ -> CANCELLED (bước 2 trước 4)", r[a], scan_result="CANCELLED")
    check("VALID_ENTRY quét sau giờ -> USED (bước 3 trước 4)", r[b], scan_result="USED",
          alert_code="DUPLICATE_SCAN")
    check("UNUSED sai cổng hết giờ -> EXPIRED (bước 4 trước 5)", r[c], scan_result="EXPIRED",
          alert_level="NONE", alert_code=None, ticket_status_before="UNUSED", ticket_status_after="UNUSED",
          distinct_wrong_gate_count=None)
    check("UNUSED trước giờ mở -> EXPIRED", r[d], scan_result="EXPIRED")
    check("Trạng thái EXPIRED, đúng cổng -> EXPIRED", r[e], scan_result="EXPIRED",
          ticket_status_before="EXPIRED", ticket_status_after="EXPIRED")
    check("UNUSED sai cổng còn giờ -> WRONG_GATE", r[f], scan_result="WRONG_GATE", alert_level="WARNING",
          alert_code="WRONG_GATE_WARNING", distinct_wrong_gate_count=1, ticket_assigned_gate_id="GATE_C",
          ticket_status_after="UNUSED")
    check("Vé không giới hạn cổng -> VALID", r[g], scan_result="VALID", ticket_assigned_gate_id=None)
    check("Đúng 20:00:00 (admission_end) -> EXPIRED", r[h], scan_result="EXPIRED")
    check("Đúng 18:00:00 (admission_start) -> VALID", r[i], scan_result="VALID")

    print("\n== Nhiều lượt cùng vé trong MỘT batch ==")
    sc = Scenario(spark)
    a = sc.scan("TK001", "GATE_A", ms("19:00:01.000"))
    b = sc.scan("TK001", "GATE_A", ms("19:00:01.000"))   # cùng mili giây: theo offset Kafka
    c = sc.scan("TK001", "GATE_A", ms("19:00:30"))
    r = sc.run()
    check("TK001 lượt 1 -> VALID", r[a], scan_result="VALID", ticket_status_before="UNUSED",
          ticket_status_after="VALID_ENTRY")
    check("TK001 lượt 2 (liền sau) -> USED", r[b], scan_result="USED", alert_code="DUPLICATE_SCAN",
          ticket_status_before="VALID_ENTRY", ticket_status_after="FLAGGED_FRAUD",
          previous_scan_event_id=a, time_since_previous_scan_ms=0)
    check("TK001 lượt 3 -> USED, giữ FLAGGED_FRAUD", r[c], scan_result="USED",
          ticket_status_before="FLAGGED_FRAUD", ticket_status_after="FLAGGED_FRAUD",
          previous_scan_event_id=a, time_since_previous_scan_ms=29_000)

    sc = Scenario(spark)  # đến Kafka ngược thứ tự received_at: vẫn xử lý theo received_at
    b = sc.scan("TK001", "GATE_D", ms("19:00:04"))
    a = sc.scan("TK001", "GATE_A", ms("19:00:01"))
    r = sc.run()
    check("Tới sau nhưng received_at sớm hơn -> VALID", r[a], scan_result="VALID")
    check("Cùng batch, GATE_A rồi GATE_D sau 3 giây -> IMPOSSIBLE_TRAVEL", r[b], scan_result="USED",
          alert_code="IMPOSSIBLE_TRAVEL", previous_scan_event_id=a, time_since_previous_scan_ms=3000)

    sc = Scenario(spark)  # sai cổng rồi mới đúng cổng trong cùng batch
    a = sc.scan("TK007", "GATE_A", ms("19:00:00"))
    b = sc.scan("TK007", "GATE_A", ms("19:00:05"))
    c = sc.scan("TK007", "GATE_B", ms("19:00:10"))
    d = sc.scan("TK007", "GATE_D", ms("19:00:15"))
    e = sc.scan("TK007", "GATE_C", ms("19:00:20"))
    f = sc.scan("TK007", "GATE_C", ms("19:00:25"))
    r = sc.run()
    check("Sai cổng A -> count 1 WARNING", r[a], scan_result="WRONG_GATE", distinct_wrong_gate_count=1,
          alert_code="WRONG_GATE_WARNING")
    check("Sai lại cổng A -> vẫn count 1", r[b], distinct_wrong_gate_count=1, alert_level="WARNING")
    check("Sai cổng B -> count 2 WARNING", r[c], distinct_wrong_gate_count=2, alert_level="WARNING")
    check("Sai cổng D -> count 3 = N-1 -> WRONG_GATE_FRAUD", r[d], distinct_wrong_gate_count=3,
          alert_level="FRAUD", alert_code="WRONG_GATE_FRAUD", ticket_status_after="UNUSED")
    check("Sau WRONG_GATE_FRAUD, đúng cổng C -> VALID", r[e], scan_result="VALID",
          ticket_status_before="UNUSED", ticket_status_after="VALID_ENTRY")
    check("Rồi quét lại cổng C -> USED", r[f], scan_result="USED", previous_scan_event_id=e)

    print("\n== Lịch sử từ batch trước (đọc ở DB) ==")
    sc = Scenario(spark)
    sc.wrong += [("TK007", "GATE_A"), ("TK007", "GATE_B")]
    a = sc.scan("TK007", "GATE_D", ms("19:00:00"))
    r = sc.run()
    check("Đã sai A, B ở batch trước, giờ sai D -> count 3 FRAUD", r[a], distinct_wrong_gate_count=3,
          alert_code="WRONG_GATE_FRAUD")
    sc = Scenario(spark)
    sc.status["TK001"] = "FLAGGED_FRAUD"
    sc.valid.append(("TK001", "00000000-0000-4000-8000-000000000001", "GATE_A", ms("19:00:01")))
    a = sc.scan("TK001", "GATE_B", ms("19:00:30"))
    r = sc.run()
    check("FLAGGED_FRAUD quét tiếp GATE_B sau 29 giây (<45) -> IMPOSSIBLE_TRAVEL, giữ FLAGGED_FRAUD",
          r[a], scan_result="USED", alert_code="IMPOSSIBLE_TRAVEL", ticket_status_before="FLAGGED_FRAUD",
          ticket_status_after="FLAGGED_FRAUD", min_travel_time_ms=45_000)
    sc = Scenario(spark)
    sc.status["TK001"] = "VALID_ENTRY"   # mâu thuẫn: không có lượt VALID nào trong DB
    a = sc.scan("TK001", "GATE_A", ms("19:30:00"))
    r = sc.run()
    check("VALID_ENTRY nhưng mất lượt VALID -> bị đánh dấu INCONSISTENT", r[a],
          problem="INCONSISTENT_TICKET_STATE")

    print("\n== build_writes: dòng ghi DB và cập nhật vé ==")
    sc = Scenario(spark)
    a = sc.scan("TK001", "GATE_A", ms("19:00:01.123"))
    b = sc.scan("TK001", "GATE_A", ms("19:00:02"))
    c = sc.scan("TK007", "GATE_A", ms("19:00:03"))
    d = sc.scan("TK006", "GATE_A", ms("19:00:04"))
    r = sc.run()
    rows, updates, rejected = build_writes(list(r.values()), ms("19:00:05"))
    by_id = {x["scan_event_id"]: x for x in rows}
    check("Mỗi dòng đúng 21 cột", {"n": {len(x) for x in rows}}, n={21})
    check("Giờ ghi dạng giờ Việt Nam", by_id[a], received_at="2026-12-12T19:00:01.123",
          processing_ts="2026-12-12T19:00:05.000")
    got = sorted((u["ticket_id"], u["status_before"], u["status_after"]) for u in updates)
    want = [("TK001", "UNUSED", "FLAGGED_FRAUD"), ("TK006", "UNUSED", "VALID_ENTRY")]
    check("Cập nhật vé: chỉ trạng thái cuối, bỏ vé không đổi (TK007)", {"u": got}, u=want)
    check("Không có dòng bị loại", {"n": len(rejected)}, n=0)
    check("epoch_ms_to_vn_iso", {"s": epoch_ms_to_vn_iso(ms("23:59:59.999"))}, s="2026-12-12T23:59:59.999")


if __name__ == "__main__":
    sys.exit(main())
