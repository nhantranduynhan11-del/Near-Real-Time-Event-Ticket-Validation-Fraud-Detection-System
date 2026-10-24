#!/usr/bin/env bash
# =============================================================================
# spark/run_bronze.sh - chạy job Bronze (Kafka -> Parquet) bằng đúng môi trường của nhóm
#
# Cách dùng (từ bất kỳ thư mục nào):
#   spark/run_bronze.sh                  # chạy liên tục, dừng bằng Ctrl+C
#   spark/run_bronze.sh --once           # xử lý hết bản tin đang có rồi thoát
#   spark/run_bronze.sh --help           # xem mọi tuỳ chọn của job
#
# Script tự dùng Python trong .venv và Java 21, không cần `source .venv/bin/activate`
# và không phụ thuộc ~/.bashrc, nên scripts/up.sh gọi trực tiếp được.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PYTHON="$REPO_ROOT/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "LỖI: chưa có môi trường ảo ở $REPO_ROOT/.venv. Làm theo spark/INSTALL.md trước." >&2
  exit 1
fi

# Nếu chưa đặt JAVA_HOME thì dùng Java 21 của Ubuntu (cùng quy ước với INSTALL.md).
: "${JAVA_HOME:=/usr/lib/jvm/java-21-openjdk-$(dpkg --print-architecture)}"
if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "LỖI: không thấy Java tại $JAVA_HOME. Làm theo spark/INSTALL.md, Bước 2 và 3." >&2
  exit 1
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

exec "$PYTHON" "$SCRIPT_DIR/bronze_scan_events.py" "$@"
