#!/usr/bin/env bash
# Đưa dữ liệu về ban đầu: reset 7 vé mẫu, xóa lượt quét, xóa Bronze và checkpoint Spark.
# Chỉ dùng trên máy dev hoặc lúc demo.   ./scripts/reset.sh [-y]
#
# docker-compose.yml và .env nằm trong docker/ (không phải thư mục gốc repo).
set -euo pipefail
cd "$(dirname "$0")/.."

SQL_FILE="database/reset_test_data.sql"
BRONZE_DIR="data/bronze"
CHECKPOINT_DIR="data/checkpoints"      # khớp với role B: nơi Spark lưu checkpoint
PID_FILE=".spark.pid"
SQLCMD="${SQLCMD:-/opt/mssql-tools18/bin/sqlcmd}"

COMPOSE_FILE="docker/docker-compose.yml"
ENV_FILE="docker/.env"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

[ -f "$COMPOSE_FILE" ] || { echo "Không thấy $COMPOSE_FILE."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Chưa có $ENV_FILE."; exit 1; }
[ -f "$SQL_FILE" ] || { echo "Không thấy $SQL_FILE."; exit 1; }

env_get() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2-; }
DB_USER="$(env_get DB_USER)"; DB_USER="${DB_USER:-sa}"
DB_PASSWORD="$(env_get DB_PASSWORD)"

if [ "${1:-}" != "-y" ]; then
  echo "Sẽ XÓA mọi lượt quét, cảnh báo, $BRONZE_DIR và $CHECKPOINT_DIR."
  read -r -p "Spark chạy tay (nếu có) đã tắt chưa? Tiếp tục? [y/N] " ans
  [ "$ans" = "y" ] || { echo "Hủy."; exit 0; }
fi

# 1. Dừng Spark do up.sh bật
if [ -f "$PID_FILE" ]; then
  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")" && echo "Đã dừng Spark."
    sleep 2
  fi
  rm -f "$PID_FILE"
fi

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

echo "Xong. Lưu ý: Kafka vẫn giữ bản tin cũ (7 ngày); Spark có đọc lại hay không tùy startingOffsets."
