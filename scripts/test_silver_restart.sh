#!/usr/bin/env bash
# =============================================================================
# scripts/test_silver_restart.sh - tắt Spark giữa chừng rồi bật lại: Silver không trùng, không mất
#
#   1. reset, dời khung giờ, bật pipeline chạy nền
#   2. gửi đợt 1 (N lượt), đợi 2 giây rồi kill -9 Spark (đang xử lý dở)
#   3. gửi đợt 2 (N lượt) trong lúc Spark tắt
#   4. bật lại Spark, gửi đợt 3 (N lượt)
#   5. đợi Silver đủ 3N dòng rồi đối chiếu:
#      - số dòng scan_event = số bản tin hợp lệ đã gửi (3N)
#      - mục 4 của check.sql trả 0 dòng
#      - trạng thái vé khớp lịch sử quét (không vé nào bị chuyển trạng thái hai lần)
#
# Cần: ./scripts/up.sh stream đã chạy. Script XÓA dữ liệu quét. Xong thì để Spark chạy nền.
#   ./scripts/test_silver_restart.sh          # N = 100
#   N=300 WAIT_S=600 ./scripts/test_silver_restart.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_db.sh
require_stack

N="${N:-100}"
PID_FILE=".spark.pid"
LOG_FILE="logs/spark.log"
mkdir -p logs

start_pipeline() {
  nohup bash spark/run_pipeline.sh >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  printf "Đợi pipeline sẵn sàng"
  for _ in $(seq 1 150); do
    kill -0 "$(cat "$PID_FILE")" 2>/dev/null || { echo; tail -n 30 "$LOG_FILE"; die "Spark thoát sớm."; }
    if [ "$(grep -c '\[pipeline\] Đang chạy' "$LOG_FILE" || true)" -gt "$1" ]; then echo " xong."; return; fi
    printf "."; sleep 2
  done
  die "pipeline chưa sẵn sàng sau 5 phút, xem $LOG_FILE"
}
silver_count() { sql "SELECT COUNT(*) FROM dbo.scan_event;"; }

echo "Đưa dữ liệu về ban đầu..."
bash scripts/reset.sh -y > /dev/null
bash scripts/dev_event_window.sh now > /dev/null
: > "$LOG_FILE"

start_pipeline 0
python3 scripts/send_scans.py --burst "$N" --seed 1 > /dev/null
sleep 2
echo "Silver lúc kill: $(silver_count) dòng. kill -9 Spark (pid $(cat "$PID_FILE"))."
kill -9 "$(cat "$PID_FILE")"
# JVM con của Spark tự thoát khi tiến trình Python chết; đợi hẳn rồi mới bật lại (cùng checkpoint)
for _ in $(seq 1 60); do
  pgrep -f "stream_scan_events.py|SparkSubmit.*pyspark-shell" > /dev/null || break
  sleep 1
done

python3 scripts/send_scans.py --burst "$N" --seed 2 > /dev/null
echo "Đã gửi đợt 2 trong lúc Spark tắt. Bật lại Spark..."
start_pipeline 1
python3 scripts/send_scans.py --burst "$N" --seed 3 > /dev/null

TOTAL=$((3 * N))
WAIT_S="${WAIT_S:-300}"
printf "Đợi Silver đủ %s dòng (tối đa %ss)" "$TOTAL" "$WAIT_S"
for _ in $(seq 1 $((WAIT_S / 2))); do
  [ "$(silver_count)" -ge "$TOTAL" ] && break
  printf "."; sleep 2
done
echo

PASS=0; FAIL=0
expect() {
  if [ "$2" = "$3" ]; then printf '[ OK ] %s\n' "$1"; PASS=$((PASS + 1))
  else printf '[FAIL] %s: nhận %s, mong đợi %s\n' "$1" "$2" "$3"; FAIL=$((FAIL + 1)); fi
}
sleep 3  # chờ thêm một chu kỳ: nếu có dòng trùng hay dư thì lúc này đã hiện ra
expect "Số dòng Silver = số bản tin đã gửi" "$(silver_count)" "$TOTAL"
expect "check.sql mục 4 (scan_event khớp fraud_alert)" "$(sql "
  SELECT COUNT(*) FROM (
    SELECT s.scan_event_id FROM dbo.scan_event s LEFT JOIN dbo.fraud_alert f ON f.scan_event_id = s.scan_event_id
    WHERE s.alert_level <> N'NONE' AND f.scan_event_id IS NULL
    UNION ALL
    SELECT f.scan_event_id FROM dbo.fraud_alert f JOIN dbo.scan_event s ON s.scan_event_id = f.scan_event_id
    WHERE s.alert_level = N'NONE' OR s.alert_code <> f.alert_code OR s.alert_level <> f.alert_level) x;")" "0"
expect "Mỗi vé tối đa một lượt VALID" "$(sql "
  SELECT COUNT(*) FROM (
    SELECT ticket_id FROM dbo.scan_event WHERE scan_result = N'VALID'
    GROUP BY ticket_id HAVING COUNT(*) > 1) x;")" "0"
expect "Vé có lượt VALID mà chưa VALID_ENTRY/FLAGGED_FRAUD, hoặc ngược lại" "$(sql "
  SELECT COUNT(*) FROM dbo.ticket t
  WHERE CASE WHEN EXISTS (SELECT 1 FROM dbo.scan_event s WHERE s.ticket_id = t.ticket_id AND s.scan_result = N'VALID')
             THEN 1 ELSE 0 END
     <> CASE WHEN t.ticket_status IN (N'VALID_ENTRY', N'FLAGGED_FRAUD') THEN 1 ELSE 0 END;")" "0"
expect "Vé có lượt USED mà chưa FLAGGED_FRAUD" "$(sql "
  SELECT COUNT(*) FROM dbo.ticket t
  WHERE t.ticket_status <> N'FLAGGED_FRAUD'
    AND EXISTS (SELECT 1 FROM dbo.scan_event s WHERE s.ticket_id = t.ticket_id AND s.scan_result = N'USED');")" "0"

echo
echo "Phân bố kết quả:"
sql "SELECT scan_result, COUNT(*) FROM dbo.scan_event GROUP BY scan_result ORDER BY scan_result;" | sed 's/^/  /'
echo
echo "KẾT QUẢ: $PASS đạt, $FAIL không đạt. Spark vẫn chạy nền (pid $(cat "$PID_FILE")), log: $LOG_FILE"
[ "$FAIL" -eq 0 ]
