#!/usr/bin/env bash
# =============================================================================
# scripts/measure_ingestion_lag.sh - đo ingestion_lag_ms (processing_ts - received_at) của N lượt quét
#
# Gửi N lượt (mặc định 100), rải đều mỗi INTERVAL_MS (mặc định 200 ms) như khách đi qua cổng,
# received_at lấy đúng lúc gửi. Đợi Silver ghi đủ rồi tính trung bình, nhỏ nhất, lớn nhất, P50, P95
# và ghi vào docs/ingestion_lag.md.
#
# Cần: pipeline đang chạy liên tục (./scripts/up.sh stream) và khung giờ sự kiện bao "bây giờ"
# (./scripts/dev_event_window.sh now). Script không xóa dữ liệu.
#   ./scripts/measure_ingestion_lag.sh
#   N=200 INTERVAL_MS=50 ./scripts/measure_ingestion_lag.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_db.sh
require_stack

N="${N:-100}"
INTERVAL_MS="${INTERVAL_MS:-200}"
OUT="docs/ingestion_lag.md"
pgrep -f stream_scan_events.py > /dev/null || die "Spark chưa chạy. Bật bằng ./scripts/up.sh stream"

echo "Gửi $N lượt quét, mỗi ${INTERVAL_MS} ms một lượt..."
mapfile -t IDS < <(python3 scripts/send_scans.py --burst "$N" --interval-ms "$INTERVAL_MS" | cut -f1)
[ "${#IDS[@]}" -eq "$N" ] || die "gửi được ${#IDS[@]}/$N lượt."
IN_LIST="$(printf "'%s'," "${IDS[@]}")"; IN_LIST="${IN_LIST%,}"

printf "Đợi Silver ghi đủ"
for _ in $(seq 1 90); do
  got="$(sql "SELECT COUNT(*) FROM dbo.scan_event WHERE scan_event_id IN ($IN_LIST);")"
  [ "$got" -ge "$N" ] && break
  printf "."; sleep 2
done
echo " $got/$N"

STATS="$(sql "
  WITH s AS (SELECT ingestion_lag_ms AS lag FROM dbo.scan_event WHERE scan_event_id IN ($IN_LIST))
  SELECT TOP (1) CONCAT(COUNT(*) OVER (), '|', CAST(AVG(CAST(lag AS FLOAT)) OVER () AS DECIMAL(10, 1)), '|',
         MIN(lag) OVER (), '|', MAX(lag) OVER (), '|',
         CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lag) OVER () AS INT), '|',
         CAST(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lag) OVER () AS INT))
  FROM s;")"
IFS='|' read -r CNT AVG MIN MAX P50 P95 <<< "$STATS"

mkdir -p docs
cat > "$OUT" <<EOF
# Độ trễ xử lý Silver (ingestion_lag_ms)

\`ingestion_lag_ms = processing_ts − received_at\` (cột tính toán của \`scan_event\`, file 08 và 12):
thời gian từ lúc API nhận lượt quét tới lúc Spark ghi xong dòng Silver.

| Hạng mục | Giá trị |
|---|---|
| Thời điểm đo | $(TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M') (giờ Việt Nam) |
| Số lượt quét | $CNT / $N |
| Cách gửi | \`scripts/send_scans.py --burst $N --interval-ms $INTERVAL_MS\` (thẳng vào Kafka, \`linger.ms=0\`) |
| Chu kỳ micro-batch Silver | 1 giây (mặc định của \`spark/stream_scan_events.py\`) |
| Máy | WSL2, Spark \`local[2]\`, SQL Server và Kafka trong Docker |

| Chỉ số | ms |
|---|---|
| **Trung bình** | **$AVG** |
| Nhỏ nhất | $MIN |
| P50 | $P50 |
| P95 | $P95 |
| **Lớn nhất** | **$MAX** |

Đo lại: \`./scripts/measure_ingestion_lag.sh\` (pipeline đang chạy, khung giờ sự kiện bao bây giờ).
EOF
echo "Trung bình ${AVG} ms, lớn nhất ${MAX} ms (P50 ${P50}, P95 ${P95}). Đã ghi $OUT"
