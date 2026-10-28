#!/usr/bin/env bash
# Bật hệ thống theo chế độ chạy (file 11, mục 7).
#   ./scripts/up.sh app      SQL Server, db-init, API
#   ./scripts/up.sh stream   SQL Server, db-init, Kafka + Spark
#   ./scripts/up.sh full     tất cả + Spark
# Không truyền gì thì chạy app.
#
# docker-compose.yml và .env nằm trong docker/ (không phải thư mục gốc repo).
# Chế độ stream/full: tự tạo topic (scripts/create_topics.sh) rồi bật job Bronze (spark/run_bronze.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-app}"
SPARK_SCRIPT="${SPARK_SCRIPT:-spark/run_bronze.sh}"   # job Bronze do role B viết
PID_FILE=".spark.pid"
LOG_FILE="logs/spark.log"

COMPOSE_FILE="docker/docker-compose.yml"
ENV_REL="docker/.env"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_REL")

case "$MODE" in
  app|stream|full) ;;
  *) echo "Dùng: ./scripts/up.sh [app|stream|full]"; exit 1 ;;
esac

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Không thấy $COMPOSE_FILE."
  exit 1
fi
if [ ! -f "$ENV_REL" ]; then
  echo "Chưa có $ENV_REL. Chạy: cp docker/.env.example $ENV_REL, rồi điền DB_PASSWORD."
  exit 1
fi
if ! grep -qE '^DB_PASSWORD=.+' "$ENV_REL"; then
  echo "DB_PASSWORD trong $ENV_REL đang trống."
  exit 1
fi

# create_topics.sh và bronze_scan_events.py mặc định đọc .env ở gốc repo; trỏ chúng sang docker/.env.
export ENV_FILE="$PWD/$ENV_REL"

echo "Bật chế độ: $MODE"
"${COMPOSE[@]}" --profile "$MODE" up -d --build

# Kafka và Spark: chỉ chế độ stream/full
if [ "$MODE" = "stream" ] || [ "$MODE" = "full" ]; then
  # Script tự đợi Kafka healthy, tạo topic nếu thiếu, chạy lại bao nhiêu lần cũng được.
  bash scripts/create_topics.sh

  # Spark chạy trực tiếp trong WSL2, không đóng hộp (file 11, mục 2)
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Spark đang chạy (pid $(cat "$PID_FILE"))."
  elif pgrep -f bronze_scan_events.py > /dev/null 2>&1; then
    echo "Đã có một job Bronze chạy tay. Không bật thêm (hai job dùng chung checkpoint sẽ hỏng)."
  elif [ -f "$SPARK_SCRIPT" ]; then
    mkdir -p logs
    nohup bash "$SPARK_SCRIPT" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 3
    if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Đã bật Spark (pid $(cat "$PID_FILE")), log: $LOG_FILE"
      echo "Lần đầu Spark tải gói Kafka từ Maven, mất 1-3 phút trước khi nhận bản tin."
    else
      rm -f "$PID_FILE"
      echo "Spark thoát ngay sau khi bật. Log:"
      tail -n 20 "$LOG_FILE" || true
      exit 1
    fi
  else
    echo "Chưa thấy $SPARK_SCRIPT. Bật Spark tay theo spark/INSTALL.md."
  fi
fi

# Đợi API trả lời (chỉ chế độ có API)
if [ "$MODE" = "app" ] || [ "$MODE" = "full" ]; then
  PORT="$(grep -E '^API_PORT=' "$ENV_REL" | cut -d= -f2- | tr -d '\r' || true)"
  PORT="${PORT:-3000}"
  printf "Đợi API ở cổng %s" "$PORT"
  for _ in $(seq 1 60); do
    if curl -fs --max-time 3 "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
      echo; echo "Xong. Mở http://localhost:$PORT"
      "${COMPOSE[@]}" ps
      exit 0
    fi
    printf "."; sleep 2
  done
  echo; echo "API chưa trả lời sau 2 phút. Xem log: docker compose -f $COMPOSE_FILE --env-file $ENV_REL logs api"
  exit 1
fi

"${COMPOSE[@]}" ps
