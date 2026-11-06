#!/usr/bin/env python3
"""spark/stream_scan_events.py - Một tiến trình Spark chạy cả Bronze và Silver (Role B).

Hai streaming query độc lập trong cùng một SparkSession (một JVM), cùng đọc topic `scan-events`:

    query "bronze": Kafka -> Parquet data/bronze/scan_events/   (spark/bronze_scan_events.py)
    query "silver": Kafka -> scan_event, fraud_alert, ticket     (spark/silver_scan_events.py)
                    -> gọi refresh_gold() của Role A               (spark/gold.py)

Mỗi query một checkpoint riêng, nên Silver lỗi thì Bronze vẫn chạy và ngược lại. Query nào dừng vì
lỗi thì được bật lại tối đa 5 lần (chờ tăng dần), quá số lần thì cả tiến trình thoát với mã 1.

Chạy (từ gốc repo, sau khi cài môi trường theo spark/INSTALL.md):

    spark/run_pipeline.sh                    # chạy liên tục, dừng bằng Ctrl+C
    spark/run_pipeline.sh --once             # xử lý hết bản tin đang có rồi thoát
    spark/run_pipeline.sh --only silver      # chỉ chạy Silver
    spark/run_pipeline.sh --help
"""
import argparse
import signal
import sys
import time
from types import SimpleNamespace

from pyspark.sql import SparkSession

import bronze_scan_events as bronze
import gold
from bronze_scan_events import KAFKA_PACKAGE, REPO_ROOT, SESSION_TZ, get_config
from silver_scan_events import SilverJob
from sqlserver import MSSQL_JDBC_PACKAGE, SqlServer

MAX_RESTARTS = 5


def parse_args(argv=None):
    data = REPO_ROOT / "data"
    p = argparse.ArgumentParser(description="Kafka scan-events -> Bronze (Parquet) + Silver (SQL Server)")
    p.add_argument("--bootstrap", default=get_config("KAFKA_EXTERNAL", "localhost:9092"),
                   help="địa chỉ Kafka, đường NGOÀI Docker (mặc định: KAFKA_EXTERNAL)")
    p.add_argument("--topic", default=get_config("KAFKA_TOPIC", "scan-events"))
    p.add_argument("--dlq-topic", default=get_config("KAFKA_DLQ_TOPIC", "scan-events-dlq"))
    p.add_argument("--only", choices=["all", "bronze", "silver"], default="all",
                   help="chạy query nào (mặc định cả hai)")
    p.add_argument("--bronze-path", default=str(data / "bronze" / "scan_events"))
    p.add_argument("--bronze-checkpoint", default=str(data / "checkpoints" / "bronze_scan_events"))
    p.add_argument("--silver-checkpoint", default=str(data / "checkpoints" / "silver_scan_events"))
    p.add_argument("--starting-offsets", default="earliest",
                   help="chỉ có tác dụng ở LẦN CHẠY ĐẦU (chưa có checkpoint): earliest hoặc latest")
    p.add_argument("--bronze-trigger-seconds", type=float, default=5,
                   help="chu kỳ micro-batch của Bronze (mặc định 5 giây: ít tệp Parquet nhỏ)")
    p.add_argument("--silver-trigger-seconds", type=float, default=1,
                   help="chu kỳ micro-batch của Silver (mặc định 1 giây: API chỉ chờ SCAN_WAIT_MS=3000)")
    p.add_argument("--max-offsets-per-trigger", type=int, default=2000,
                   help="số bản tin tối đa mỗi batch Silver (giới hạn bộ nhớ driver)")
    p.add_argument("--once", action="store_true",
                   help="xử lý hết bản tin đang có trong Kafka rồi thoát (dùng để thử)")
    return p.parse_args(argv)


def db_settings():
    """Kết nối SQL Server từ WSL (ngoài Docker): DB_HOST_EXTERNAL. SPARK_DB_* để dành cho tài khoản
    riêng của Spark ở Phase 8 (bảo mật); chưa đặt thì dùng DB_USER/DB_PASSWORD."""
    return dict(
        host=get_config("DB_HOST_EXTERNAL", "localhost"),
        port=int(get_config("DB_PORT", "1433")),
        database=get_config("DB_NAME", "ticket_system"),
        user=get_config("SPARK_DB_USER", "") or get_config("DB_USER", "sa"),
        password=get_config("SPARK_DB_PASSWORD", "") or get_config("DB_PASSWORD", ""),
        encrypt=get_config("DB_ENCRYPT", "false").lower() == "true",
    )


def build_spark() -> SparkSession:
    return (SparkSession.builder.master("local[2]").appName("ticket_pipeline")
            .config("spark.sql.session.timeZone", SESSION_TZ)
            .config("spark.sql.parquet.outputTimestampType", "TIMESTAMP_MICROS")
            .config("spark.sql.shuffle.partitions", "2")
            .config("spark.scheduler.mode", "FAIR")          # hai query chia đều 2 lõi
            .config("spark.ui.showConsoleProgress", "false")
            # PySpark 4 mặc định ghi lại vị trí dòng code cho mỗi Column (inspect.stack()), làm dựng
            # plan Silver chậm thêm ~0.4-2 giây mỗi batch. Tắt đi: chỉ mất thông tin gỡ lỗi.
            .config("spark.python.sql.dataFrameDebugging.enabled", "false")
            .config("spark.jars.packages", f"{KAFKA_PACKAGE},{MSSQL_JDBC_PACKAGE}")
            .getOrCreate())


def wait_for_db(db, event_id, timeout_s=180):
    """Chế độ stream không có API chờ db-init, nên Spark có thể lên trước khi bảng được tạo."""
    deadline = time.time() + timeout_s
    while True:
        try:
            with db.transaction():
                (ev,) = db.query_json(
                    "SELECT (SELECT event_id FROM dbo.[event] WHERE event_id = ? FOR JSON PATH) AS ev",
                    event_id)
            if ev:
                return
            problem = f"chưa có sự kiện {event_id} trong bảng event (seed.sql chưa nạp?)"
        except Exception as exc:  # noqa: BLE001 - chưa nối được thì chờ tiếp
            problem = str(exc).splitlines()[0][:200]
            db.close()
        if time.time() > deadline:
            raise SystemExit(f"LỖI: SQL Server chưa sẵn sàng sau {timeout_s}s: {problem}")
        print(f"[pipeline] chờ SQL Server: {problem}", flush=True)
        time.sleep(5)


def kafka_source(spark, args, max_offsets=None):
    reader = (spark.readStream.format("kafka")
              .option("kafka.bootstrap.servers", args.bootstrap)
              .option("subscribe", args.topic)
              .option("startingOffsets", args.starting_offsets))
    if max_offsets:
        reader = reader.option("maxOffsetsPerTrigger", str(max_offsets))
    return reader.load()


def start_bronze(spark, args):
    bronze_args = SimpleNamespace(bronze_path=args.bronze_path, bootstrap=args.bootstrap,
                                  dlq_topic=args.dlq_topic)
    writer = (kafka_source(spark, args).writeStream.queryName("bronze")
              .foreachBatch(bronze.make_batch_handler(bronze_args, bronze.write_dlq_to_kafka))
              .option("checkpointLocation", args.bronze_checkpoint))
    writer = (writer.trigger(availableNow=True) if args.once
              else writer.trigger(processingTime=f"{args.bronze_trigger_seconds} seconds"))
    return writer.start()


def start_silver(spark, args, job):
    writer = (kafka_source(spark, args, args.max_offsets_per_trigger).writeStream.queryName("silver")
              .foreachBatch(job.handle_batch)
              .option("checkpointLocation", args.silver_checkpoint))
    writer = (writer.trigger(availableNow=True) if args.once
              else writer.trigger(processingTime=f"{args.silver_trigger_seconds} seconds"))
    return writer.start()


def supervise(spark, starters, once):
    """Chạy các query; query nào chết vì lỗi thì bật lại (tối đa MAX_RESTARTS lần)."""
    queries = {name: start() for name, start in starters.items()}
    restarts = dict.fromkeys(queries, 0)
    print(f"[pipeline] Đang chạy: {', '.join(queries)}", flush=True)
    while any(q.isActive for q in queries.values()):
        try:
            spark.streams.awaitAnyTermination()
        except Exception:  # noqa: BLE001 - xem lỗi từng query ở dưới
            pass
        spark.streams.resetTerminated()
        for name, q in list(queries.items()):
            if q.isActive:
                continue
            err = q.exception()
            if err is None:
                continue  # dừng bình thường (--once đã xử lý xong)
            print(f"[pipeline] query {name} dừng vì lỗi: {str(err).splitlines()[0][:500]}", flush=True)
            if once or restarts[name] >= MAX_RESTARTS:
                for other in queries.values():
                    if other.isActive:
                        other.stop()
                raise SystemExit(f"LỖI: query {name} dừng vì lỗi, không bật lại nữa.")
            restarts[name] += 1
            wait = min(30, 5 * restarts[name])
            print(f"[pipeline] bật lại {name} sau {wait}s (lần {restarts[name]}/{MAX_RESTARTS})", flush=True)
            time.sleep(wait)
            queries[name] = starters[name]()


def _stop_on_sigterm(signum, frame):  # noqa: ARG001
    raise KeyboardInterrupt  # kill <pid> (reset.sh) dừng gọn như Ctrl+C


def main(argv=None):
    args = parse_args(argv)
    event_id = get_config("ACTIVE_EVENT_ID", "EV001")
    settings = db_settings()
    print("Pipeline Spark: Kafka -> Bronze + Silver")
    print(f"  Kafka      : {args.bootstrap}  (topic={args.topic}, dlq={args.dlq_topic})")
    print(f"  Query      : {args.only}   {'chạy một lần' if args.once else 'liên tục'}")
    print(f"  Bronze     : {args.bronze_path}  (checkpoint {args.bronze_checkpoint})")
    print(f"  Silver     : SQL Server {settings['host']}:{settings['port']}/{settings['database']}"
          f"  ACTIVE_EVENT_ID={event_id}  (checkpoint {args.silver_checkpoint})")
    print(f"  Múi giờ    : {SESSION_TZ}", flush=True)
    if not settings["password"]:
        raise SystemExit("LỖI: chưa có DB_PASSWORD (docker/.env). Chạy qua scripts/up.sh hoặc đặt ENV_FILE.")

    signal.signal(signal.SIGTERM, _stop_on_sigterm)
    spark = build_spark()
    spark.sparkContext.setLogLevel("WARN")
    db = SqlServer(spark, **settings)
    try:
        starters = {}
        if args.only in ("all", "bronze"):
            starters["bronze"] = lambda: start_bronze(spark, args)
        if args.only in ("all", "silver"):
            wait_for_db(db, event_id)
            job = SilverJob(spark, db, event_id, args.bootstrap, args.dlq_topic,
                            gold_hook=gold.refresh_gold)
            job.warm_up()                    # để lượt quét đầu tiên không phải chờ JVM "nóng máy"
            job.refresh_gold(batch_id=None)  # bù Gold lúc khởi động
            starters["silver"] = lambda: start_silver(spark, args, job)
        supervise(spark, starters, args.once)
    except KeyboardInterrupt:
        print("\nĐang dừng pipeline...", flush=True)
        for q in spark.streams.active:
            q.stop()
    finally:
        db.close()
        spark.stop()


if __name__ == "__main__":
    sys.exit(main())
