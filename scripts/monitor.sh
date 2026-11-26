#!/usr/bin/env bash
# =============================================================================
# scripts/monitor.sh - theo dõi hệ thống bằng một lệnh (B3, phần Monitoring của Database administration)
#
#   1. Truy vấn chạy chậm nhất trên ticket_system (sys.dm_exec_query_stats, tính từ lần SQL Server bật)
#   2. Kích thước và số dòng từng bảng (sys.dm_db_partition_stats)
#   3. Độ trễ pipeline của các lượt quét gần nhất (ingestion_lag_ms), Spark còn chạy không,
#      Spark còn tồn bao nhiêu bản tin chưa xử lý, Gold có theo kịp Silver không
#   4. Số bản tin trong topic DLQ, chia theo lý do (header dlq_reason do Spark gắn)
#
# Cần: SQL Server và Kafka đang chạy (./scripts/up.sh stream hoặc full). Chỉ đọc, không sửa gì.
#   ./scripts/monitor.sh              in ra màn hình
#   ./scripts/monitor.sh -n 500       độ trễ tính trên 500 lượt quét gần nhất (mặc định 100)
#   ./scripts/monitor.sh --save       in ra và ghi lại vào docs/monitoring.md làm ví dụ
#   ./scripts/monitor.sh --no-dlq-detail   bỏ bước đọc header DLQ (nhanh hơn vài giây)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_db.sh

RECENT=100
SAVE=0
DLQ_DETAIL=1
while (($#)); do
  case "$1" in
    -n) [[ ${2:-} =~ ^[0-9]+$ ]] || die "-n cần một số"; RECENT=$2; shift ;;
    --save) SAVE=1 ;;
    --no-dlq-detail) DLQ_DETAIL=0 ;;
    -h|--help) sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "tham số lạ: $1 (xem --help)" ;;
  esac
  shift
done
require_stack

KAFKA_CONTAINER="${KAFKA_CONTAINER:-kafka}"
TOPIC="$(env_get KAFKA_TOPIC)"; TOPIC="${TOPIC:-scan-events}"
DLQ_TOPIC="$(env_get KAFKA_DLQ_TOPIC)"; DLQ_TOPIC="${DLQ_TOPIC:-scan-events-dlq}"
CHECKPOINT_OFFSETS="data/checkpoints/silver_scan_events/offsets"
NOW_VN="DATEADD(HOUR, 7, SYSUTCDATETIME())"

kexec() {
  docker exec -e KAFKA_HEAP_OPTS="-Xmx128m -Xms64m" "$KAFKA_CONTAINER" "/opt/kafka/bin/$1" \
    --bootstrap-server localhost:9092 "${@:2}"
}
# Tổng offset của một topic: --time -1 là cuối, -2 là đầu (bản tin cũ nhất còn giữ)
# (|| true: topic chưa có thì coi như 0, không để pipefail làm dừng cả script)
topic_sum() { { kexec kafka-get-offsets.sh --topic "$1" --time "$2" 2>/dev/null || true; } | awk -F: '{s += $NF} END {print s + 0}'; }
table() { column -t -s '|'; }
section() { printf '\n== %s ==\n' "$1"; }

report() {
  echo "Theo dõi hệ thống — $(TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M:%S') (giờ Việt Nam), ACTIVE_EVENT_ID=$ACTIVE_EVENT_ID"

  section "1. Truy vấn chạy chậm nhất (trung bình mỗi lần, tính từ lúc SQL Server bật)"
  {
    echo "số_lần|tb_ms|lớn_nhất_ms|tb_logical_reads|câu_lệnh"
    sql "SELECT TOP (10) CONCAT(qs.execution_count, '|',
            CAST(qs.total_elapsed_time / 1000.0 / qs.execution_count AS DECIMAL(12, 1)), '|',
            CAST(qs.max_elapsed_time / 1000.0 AS DECIMAL(12, 1)), '|',
            qs.total_logical_reads / qs.execution_count, '|',
            LEFT(LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(SUBSTRING(st.text, qs.statement_start_offset / 2 + 1,
                 (CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text) ELSE qs.statement_end_offset END
                  - qs.statement_start_offset) / 2 + 1), CHAR(13), ' '), CHAR(10), ' '), CHAR(9), ' '), '|', '/')), 90))
         FROM sys.dm_exec_query_stats AS qs
         CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st
         CROSS APPLY sys.dm_exec_plan_attributes(qs.plan_handle) AS pa
         WHERE pa.attribute = N'dbid' AND CAST(pa.value AS INT) = DB_ID()
           -- Bỏ câu đọc catalog hệ thống: truy vấn thống kê định kỳ của chính SQL Server (bắt đầu bằng
           -- SELECT db_id() as database_id, có câu viết [sys].[...] nên lọc cả hai dạng) và của
           -- monitor.sh. Câu của API, Spark, Gold không đụng sys.*. [[] trong LIKE là dấu [ thật.
           AND st.text NOT LIKE N'%sys.%'
           AND st.text NOT LIKE N'%[[]sys].%'
           AND st.text NOT LIKE N'%db_id() as database_id%'
         ORDER BY qs.total_elapsed_time / qs.execution_count DESC;"
  } | table

  section "2. Kích thước và số dòng từng bảng"
  {
    echo "bảng|số_dòng|tổng_MB|dữ_liệu_MB|index_phụ_MB|số_index_phụ"
    sql "SELECT CONCAT(t.name, '|',
            SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.row_count ELSE 0 END), '|',
            CAST(SUM(ps.reserved_page_count) * 8 / 1024.0 AS DECIMAL(10, 2)), '|',
            CAST(SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.used_page_count ELSE 0 END) * 8 / 1024.0 AS DECIMAL(10, 2)), '|',
            CAST(SUM(CASE WHEN ps.index_id > 1 THEN ps.used_page_count ELSE 0 END) * 8 / 1024.0 AS DECIMAL(10, 2)), '|',
            COUNT(DISTINCT CASE WHEN ps.index_id > 1 THEN ps.index_id END))
         FROM sys.tables AS t
         JOIN sys.dm_db_partition_stats AS ps ON ps.object_id = t.object_id
         GROUP BY t.name
         ORDER BY SUM(ps.reserved_page_count) DESC, t.name;"
  } | table

  section "3. Pipeline: độ trễ ${RECENT} lượt quét gần nhất (ingestion_lag_ms = processing_ts - received_at)"
  local lag
  lag="$(sql "WITH r AS (SELECT TOP ($RECENT) ingestion_lag_ms AS lag, received_at FROM dbo.scan_event ORDER BY received_at DESC)
              SELECT TOP (1) CONCAT(COUNT(*) OVER (), '|', CAST(AVG(CAST(lag AS FLOAT)) OVER () AS DECIMAL(10, 1)), '|',
                     CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lag) OVER () AS INT), '|',
                     CAST(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lag) OVER () AS INT), '|',
                     MAX(lag) OVER (), '|', CONVERT(VARCHAR(23), MAX(received_at) OVER (), 121))
              FROM r;")"
  if [ -z "$lag" ]; then
    echo "Chưa có lượt quét nào trong scan_event."
  else
    { echo "số_lượt|tb_ms|P50_ms|P95_ms|lớn_nhất_ms|lượt_mới_nhất"; echo "$lag"; } | table
  fi
  echo
  echo "Lượt quét Spark ghi trong 5 phút qua: $(sql "SELECT COUNT(*) FROM dbo.scan_event WHERE processing_ts >= DATEADD(MINUTE, -5, $NOW_VN);")"

  local pid
  pid="$(pgrep -f stream_scan_events.py | head -n1 || true)"
  if [ -n "$pid" ]; then
    echo "Spark: đang chạy (pid $pid), $(ps -o etime= -p "$pid" | tr -d ' ') từ lúc bật"
  else
    echo "Spark: KHÔNG chạy. Bật bằng ./scripts/up.sh stream (hoặc full)"
  fi

  # Bản tin còn tồn: offset cuối của topic trừ offset Spark đã lên kế hoạch tới (checkpoint Silver)
  local latest end_total done_total
  latest="$(ls -1 "$CHECKPOINT_OFFSETS" 2>/dev/null | grep -E '^[0-9]+$' | sort -n | tail -n1 || true)"
  end_total="$(topic_sum "$TOPIC" -1)"
  if [ -n "$latest" ]; then
    done_total="$(tail -n1 "$CHECKPOINT_OFFSETS/$latest" | python3 -c \
      "import json,sys; d=json.load(sys.stdin); print(sum(sum(p.values()) for p in d.values()))" 2>/dev/null || echo "")"
    if [ -n "$done_total" ]; then
      echo "Kafka $TOPIC: $end_total bản tin; Spark đã nhận tới $done_total (đợt $latest); còn tồn: $((end_total > done_total ? end_total - done_total : 0))"
    fi
  else
    echo "Kafka $TOPIC: $end_total bản tin; chưa có checkpoint Silver ($CHECKPOINT_OFFSETS)"
  fi

  # Chuỗi có dấu phải là N'...': chuỗi thường đi qua code page 1258 của collation Vietnamese_CI_AS,
  # chữ như "ầ", "ố", "ạ" không có sẵn ở dạng dựng sẵn nên thành "?".
  echo "Gold so với Silver: $(sql "SELECT CONCAT(N'Silver ghi lần cuối ', ISNULL(CONVERT(VARCHAR(23), MAX(processing_ts), 121), '-'),
      N', Gold tính lại lần cuối ', ISNULL(CONVERT(VARCHAR(23), (SELECT MAX(updated_at) FROM dbo.gold_event_stats), 121), '-'),
      CASE WHEN MAX(processing_ts) IS NULL THEN N''
           WHEN (SELECT MAX(updated_at) FROM dbo.gold_event_stats) >= MAX(processing_ts) THEN N' (Gold đã theo kịp)'
           ELSE N' (Gold CHƯA theo kịp Silver)' END)
    FROM dbo.scan_event;")"

  section "4. Bản tin trong DLQ ($DLQ_TOPIC)"
  local dlq_end dlq_begin
  dlq_end="$(topic_sum "$DLQ_TOPIC" -1)"
  dlq_begin="$(topic_sum "$DLQ_TOPIC" -2)"
  echo "Đang giữ: $((dlq_end - dlq_begin)) bản tin (tổng từng nhận: $dlq_end)"
  if [ "$DLQ_DETAIL" = 1 ] && [ $((dlq_end - dlq_begin)) -gt 0 ]; then
    echo "Theo lý do (Bronze: JSON hỏng hoặc thiếu trường, không có header; Silver: có header dlq_reason):"
    # Công cụ đọc dừng bằng timeout và trả mã lỗi; đó là cách dừng bình thường nên bỏ qua mã lỗi
    { kexec kafka-console-consumer.sh --topic "$DLQ_TOPIC" --from-beginning --timeout-ms 4000 \
        --max-messages 5000 --property print.headers=true --property print.value=false 2>/dev/null || true; } \
      | sed -E 's/.*dlq_reason:([A-Z0-9_]+).*/\1/; s/^NO_HEADERS$/BRONZE (bản tin hỏng)/' \
      | sort | uniq -c | sort -rn | sed 's/^/  /'
  fi
}

if [ "$SAVE" = 1 ]; then
  tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
  report | tee "$tmp"
  mkdir -p docs
  {
    echo "# Theo dõi hệ thống (scripts/monitor.sh)"
    echo
    echo "Ví dụ kết quả chạy \`./scripts/monitor.sh --save\` lúc $(TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M') (giờ Việt Nam)."
    echo "Ý nghĩa từng phần: xem đầu tệp \`scripts/monitor.sh\` và mục 7.2 của README."
    echo
    echo '```text'
    cat "$tmp"
    echo '```'
  } > docs/monitoring.md
  echo; echo "Đã ghi docs/monitoring.md"
else
  report
fi
