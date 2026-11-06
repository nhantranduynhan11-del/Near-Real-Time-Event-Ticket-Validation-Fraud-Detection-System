#!/usr/bin/env bash
# =============================================================================
# spark/run_pipeline.sh - chạy pipeline Spark (Bronze + Silver) bằng đúng môi trường của nhóm
#
# Cách dùng (từ bất kỳ thư mục nào):
#   spark/run_pipeline.sh                  # chạy liên tục, dừng bằng Ctrl+C
#   spark/run_pipeline.sh --once           # xử lý hết bản tin đang có rồi thoát
#   spark/run_pipeline.sh --only silver    # chỉ chạy Silver
#   spark/run_pipeline.sh --help           # xem mọi tuỳ chọn
#
# Cấu hình (DB_*, KAFKA_*, ACTIVE_EVENT_ID) đọc từ docker/.env, trừ khi đã đặt ENV_FILE.
# Script tự dùng Python trong .venv và Java 21, giống spark/run_bronze.sh.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PYTHON="$REPO_ROOT/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "LỖI: chưa có môi trường ảo ở $REPO_ROOT/.venv. Làm theo spark/INSTALL.md trước." >&2
  exit 1
fi

: "${JAVA_HOME:=/usr/lib/jvm/java-21-openjdk-$(dpkg --print-architecture)}"
if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "LỖI: không thấy Java tại $JAVA_HOME. Làm theo spark/INSTALL.md, Bước 2 và 3." >&2
  exit 1
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

# Mật khẩu DB nằm trong docker/.env (cùng tệp docker compose dùng)
export ENV_FILE="${ENV_FILE:-$REPO_ROOT/docker/.env}"

exec "$PYTHON" "$SCRIPT_DIR/stream_scan_events.py" "$@"
