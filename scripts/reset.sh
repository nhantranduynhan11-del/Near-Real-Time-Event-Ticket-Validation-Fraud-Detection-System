#!/usr/bin/env bash
# Bật hệ thống theo chế độ chạy (file 11, mục 7).
#   ./scripts/up.sh app      SQL Server, db-init, API
#   ./scripts/up.sh stream   SQL Server, db-init, Kafka + Spark
#   ./scripts/up.sh full     tất cả + Spark
# Không truyền gì thì chạy app.
#
# docker-compose.yml và .env nằm trong docker/ (không phải thư mục gốc repo).
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-app}"
SPARK_SCRIPT="${SPARK_SCRIPT:-spark/run.sh}"   # lệnh chạy Spark do role B viết
PID_FILE=".spark.pid"
LOG_FILE="logs/spark.log"

COMPOSE_FILE="docker/docker-compose.yml"
ENV_FILE="docker/.env"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

case "$MODE" in
  app|stream|full) ;;
  *) echo "Dùng: ./scripts/up.sh [app|stream|full]"; exit 1 ;;
esac

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Không thấy $COMPOSE_FILE."
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "Chưa có $ENV_FILE. Chạy: cp docker/.env.example $ENV_FILE, rồi điền DB_PASSWORD."
  exit 1
fi
if ! grep -qE '^DB_PASSWORD=.+' "$ENV_FILE"; then
  echo "DB_PASSWORD trong $ENV_FILE đang trống."
  exit 1
fi

echo "Bật chế độ: $MODE"
"${COMPOSE[@]}" --profile "$MODE" up -d --build

# Spark chạy trực tiếp trong WSL2, không đóng hộp (file 11, mục 2)
if [ "$MODE" = "stream" ] || [ "$MODE" = "full" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Spark đang chạy (pid $(cat "$PID_FILE"))."
  elif [ -f "$SPARK_SCRIPT" ]; then
    mkdir -p logs
    nohup bash "$SPARK_SCRIPT" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Đã bật Spark (pid $(cat "$PID_FILE")), log: $LOG_FILE"
  else
    echo "Chưa thấy $SPARK_SCRIPT. Bật Spark tay theo spark/README.md."
  fi
fi

# Đợi API trả lời (chỉ chế độ có API)
if [ "$MODE" = "app" ] || [ "$MODE" = "full" ]; then
  PORT="$(grep -E '^API_PORT=' "$ENV_FILE" | cut -d= -f2- || true)"
  PORT="${PORT:-3000}"
  printf "Đợi API ở cổng %s" "$PORT"
  for _ in $(seq 1 60); do
    if curl -fs "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
      echo; echo "Xong. Mở http://localhost:$PORT"
      "${COMPOSE[@]}" ps
      exit 0
    fi
    printf "."; sleep 2
  done
  echo; echo "API chưa trả lời sau 2 phút. Xem log: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs api"
  exit 1
fi

"${COMPOSE[@]}" ps
