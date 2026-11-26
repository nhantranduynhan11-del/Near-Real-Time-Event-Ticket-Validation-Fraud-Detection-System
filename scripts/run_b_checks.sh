#!/usr/bin/env bash
# =============================================================================
# scripts/run_b_checks.sh - chạy một lần các bước kiểm của Role B cần hệ thống thật
#
#   B2  python3 scripts/load_test.py   -> docs/performance.md, biểu đồ, docs/performance_data/
#   B3  ./scripts/monitor.sh --save    -> docs/monitoring.md
#   B4  ./scripts/run_test_cases.sh    -> TC01-TC08 qua API; Spark chạy bằng SPARK_DB_USER nếu đã điền
#   B1  ./scripts/test_boundaries.sh   -> 140 000 ms, mốc cuối giờ nhận khách, cổng sai N-1
#
# Thứ tự cố định: test_boundaries.sh xóa dữ liệu quét và tắt Spark nên chạy sau cùng. Đầu và cuối
# script đều reset dữ liệu (như reset.sh -y), cuối cùng bật lại Spark và trả khung giờ demo.
# Cần máy từ 8 GB RAM (SQL Server + Kafka + Spark + API cùng lúc), khoảng 15 phút. Không commit gì.
#
#   ./scripts/run_b_checks.sh            # tải 25 lượt/giây x 120 giây
#   ./scripts/run_b_checks.sh --quick    # tải 10 lượt/giây x 30 giây, để chạy thử
#   ./scripts/run_b_checks.sh --skip-tc  # bỏ TC01-TC08
# Log từng bước: logs/b_checks_<giờ>/
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

RATE=25; DURATION=120; RUN_TC=1
for a in "$@"; do
  case "$a" in
    --quick)   RATE=10; DURATION=30 ;;
    --skip-tc) RUN_TC=0 ;;
    -h|--help) awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); if ($0 ~ /^====/) exit; print }' "$0"; exit 0 ;;
    *) echo "Không hiểu tùy chọn '$a' (xem --help)."; exit 2 ;;
  esac
done

# ---------- kiểm điều kiện ----------
[ -f docker/.env ] || { echo "Chưa có docker/.env (cp docker/.env.example docker/.env rồi điền)."; exit 1; }
for c in docker python3 curl jq; do
  command -v "$c" > /dev/null 2>&1 || { echo "Thiếu lệnh '$c'."; exit 1; }
done
mem_mb=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
if [ "$mem_mb" -lt 7000 ]; then
  echo "CẢNH BÁO: máy (hoặc máy ảo WSL) chỉ có ${mem_mb} MB RAM. Dưới 8 GB, SQL Server + Kafka + Spark dễ làm sập máy."
fi
env_val() { grep -E "^$1=" docker/.env | tail -n1 | cut -d= -f2- | tr -d '\r' || true; }
SPARK_ACC="$(env_val SPARK_DB_USER)"
if [ -n "$SPARK_ACC" ]; then
  echo "Spark sẽ đăng nhập bằng '$SPARK_ACC' (B4)."
else
  echo "CẢNH BÁO: SPARK_DB_USER đang trống nên Spark dùng sa; phần tài khoản riêng của B4 sẽ không được kiểm."
fi

LOG="logs/b_checks_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$LOG"
SUMMARY=(); FAILED=0

step() {  # step "tên bước" tên_log lệnh...
  local name="$1" log="$LOG/$2" t0=$SECONDS
  shift 2
  echo; echo "=== $name   (log: $log)"
  if "$@" 2>&1 | tee "$log"; then
    SUMMARY+=("ĐẠT  $name ($((SECONDS - t0)) giây)")
  else
    SUMMARY+=("LỖI  $name ($((SECONDS - t0)) giây), xem $log"); FAILED=1
    return 1
  fi
}

wait_spark() {  # up.sh ghi đè logs/spark.log mỗi lần bật; lần đầu Spark tải gói Kafka mất 1-3 phút
  for _ in $(seq 1 120); do
    if grep -q "\[pipeline\] Đang chạy" logs/spark.log 2>/dev/null; then
      grep -m1 "tài khoản" logs/spark.log
      return 0
    fi
    if [ -f .spark.pid ] && ! kill -0 "$(cat .spark.pid)" 2>/dev/null; then
      echo "Spark đã thoát:"; tail -n 25 logs/spark.log; return 1
    fi
    sleep 2
  done
  echo "Spark chưa sẵn sàng sau 4 phút:"; tail -n 25 logs/spark.log; return 1
}

finish() {
  echo; echo "=== TÓM TẮT (log: $LOG/)"
  printf '  %s\n' "${SUMMARY[@]}"
  echo; echo "Tệp docs/ đã đổi. Xem lại rồi commit từng tệp (đừng dùng git add .):"
  git status --short -- docs/
  exit "$FAILED"
}

# ---------- chuẩn bị: bật, reset, bật lại Spark với docker/.env hiện tại ----------
step "Bật hệ thống (full)" 01_up.log bash scripts/up.sh full || finish
step "Đưa dữ liệu về ban đầu" 02_reset.log bash scripts/reset.sh -y || finish
step "Bật lại Spark" 03_up.log bash scripts/up.sh full || finish
step "Đợi Spark sẵn sàng" 04_spark_ready.log wait_spark || finish
step "Dời khung giờ nhận khách về hiện tại" 05_window.log bash scripts/dev_event_window.sh now || finish

# ---------- các bước kiểm (một bước lỗi vẫn chạy tiếp bước sau) ----------
step "B2 đo tải ${RATE} lượt/giây x ${DURATION} giây" 06_load_test.log \
  python3 scripts/load_test.py --rate "$RATE" --duration "$DURATION"
step "B3 monitor.sh --save" 07_monitor.log bash scripts/monitor.sh --save
if [ "$RUN_TC" = 1 ]; then
  step "B4 TC01-TC08 qua API (Spark bằng ${SPARK_ACC:-sa})" 08_test_cases.log bash scripts/run_test_cases.sh
fi
step "B1 ba ca ranh giới" 09_boundaries.log bash scripts/test_boundaries.sh

# ---------- dọn: dữ liệu ban đầu, Spark chạy, giờ demo ----------
echo; echo "=== Dọn: reset dữ liệu, bật lại Spark, trả khung giờ demo   (log: $LOG/10_cleanup.log)"
if { bash scripts/reset.sh -y && bash scripts/up.sh full && bash scripts/dev_event_window.sh demo; } \
     > "$LOG/10_cleanup.log" 2>&1; then
  SUMMARY+=("ĐẠT  Dọn")
else
  SUMMARY+=("LỖI  Dọn, xem $LOG/10_cleanup.log"); FAILED=1
fi
finish
