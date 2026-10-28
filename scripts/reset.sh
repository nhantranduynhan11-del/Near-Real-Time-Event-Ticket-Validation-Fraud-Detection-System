#!/usr/bin/env bash
# Đưa dữ liệu về ban đầu: reset 7 vé mẫu, xóa lượt quét, xóa Bronze, checkpoint Spark và bản tin trong Kafka.
# Chỉ dùng trên máy dev hoặc lúc demo.   ./scripts/reset.sh [-y]
#
# docker-compose.yml và .env nằm trong docker/ (không phải thư mục gốc repo).
set -euo pipefail
cd "$(dirname "$0")/.."

SQL_FILE="database/reset_test_data.sql"
BRONZE_DIR="data/bronze"
CHECKPOINT_DIR="data/checkpoints"      # job Bronze lưu ở data/checkpoints/bronze_scan_events
PID_FILE=".spark.pid"
SQLCMD="${SQLCMD:-/opt/mssql-tools18/bin/sqlcmd}"
KAFKA_CONTAINER="${KAFKA_CONTAINER:-kafka}"
KAFKA_BIN="/opt/kafka/bin"

COMPOSE_FILE="docker/docker-compose.yml"
ENV_FILE="docker/.env"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

[ -f "$COMPOSE_FILE" ] || { echo "Không thấy $COMPOSE_FILE."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Chưa có $ENV_FILE."; exit 1; }
[ -f "$SQL_FILE" ] || { echo "Không thấy $SQL_FILE."; exit 1; }

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r' || true; }
DB_USER="$(env_get DB_USER)"; DB_USER="${DB_USER:-sa}"
DB_PASSWORD="$(env_get DB_PASSWORD)"
TOPIC_MAIN="$(env_get KAFKA_TOPIC)"; TOPIC_MAIN="${TOPIC_MAIN:-scan-events}"
TOPIC_DLQ="$(env_get KAFKA_DLQ_TOPIC)"; TOPIC_DLQ="${TOPIC_DLQ:-scan-events-dlq}"

if [ "${1:-}" != "-y" ]; then
  echo "Sẽ XÓA mọi lượt quét, cảnh báo, $BRONZE_DIR, $CHECKPOINT_DIR và bản tin trong topic Kafka."
  read -r -p "Tiếp tục? [y/N] " ans
  [ "$ans" = "y" ] || { echo "Hủy."; exit 0; }
fi

# 1. Dừng Spark (do up.sh bật hoặc chạy tay): đang chạy mà xóa checkpoint sẽ hỏng
if [ -f "$PID_FILE" ]; then
  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")" && echo "Đã dừng Spark."
  fi
  rm -f "$PID_FILE"
fi
if pgrep -f bronze_scan_events.py > /dev/null 2>&1; then
  pkill -f bronze_scan_events.py && echo "Đã dừng job Bronze chạy tay."
fi
sleep 2

# 2. Reset SQL Server (cần container sqlserver đang chạy)
export COMPOSE_PROFILES=full
if ! "${COMPOSE[@]}" ps --status running --services | grep -qx sqlserver; then
  echo "SQL Server chưa chạy. Bật bằng ./scripts/up.sh trước."
  exit 1
fi
"${COMPOSE[@]}" exec -T -e SQLCMDPASSWORD="$DB_PASSWORD" sqlserver \
  "$SQLCMD" -S localhost -U "$DB_USER" -C -b -I -f 65001 < "$SQL_FILE"
echo "Đã reset bảng vé và xóa lượt quét."

# 3. Xóa Bronze và checkpoint
rm -rf "$BRONZE_DIR" "$CHECKPOINT_DIR"
echo "Đã xóa $BRONZE_DIR và $CHECKPOINT_DIR."

# 4. Làm rỗng Kafka (nếu đang chạy). Job Bronze đọc từ earliest, để lại bản tin cũ thì Bronze nạp lại ngay.
if [ "$(docker inspect -f '{{.State.Running}}' "$KAFKA_CONTAINER" 2>/dev/null || true)" = "true" ]; then
  kexec() { docker exec -e KAFKA_HEAP_OPTS="-Xmx128m -Xms64m" "$KAFKA_CONTAINER" "$KAFKA_BIN/$1" --bootstrap-server localhost:9092 "${@:2}"; }
  for t in "$TOPIC_MAIN" "$TOPIC_DLQ"; do
    kexec kafka-topics.sh --delete --if-exists --topic "$t" > /dev/null
  done
  # Xóa topic chạy nền: đợi tới khi biến mất hẳn rồi mới tạo lại
  for _ in $(seq 1 30); do
    left="$(kexec kafka-topics.sh --list 2>/dev/null | grep -cxE "$TOPIC_MAIN|$TOPIC_DLQ" || true)"
    [ "$left" = "0" ] && break
    sleep 1
  done
  ENV_FILE="$PWD/$ENV_FILE" bash scripts/create_topics.sh > /dev/null
  echo "Đã xóa và tạo lại topic $TOPIC_MAIN, $TOPIC_DLQ."
else
  echo "Kafka không chạy nên chưa làm rỗng topic. Nếu từng bật stream/full, bản tin cũ vẫn còn trong Kafka."
fi

echo "Xong."
