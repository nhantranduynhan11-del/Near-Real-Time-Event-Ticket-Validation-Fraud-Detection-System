# scripts/_db.sh - hàm dùng chung cho các script thử (source, không chạy trực tiếp).
# Chạy câu SQL bằng sqlcmd BÊN TRONG container sqlserver, nên máy không cần cài sqlcmd.
# Yêu cầu: đứng ở gốc repo, có docker/.env.

COMPOSE_FILE="docker/docker-compose.yml"
ENV_REL="docker/.env"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_REL")
SQLCMD_BIN="${SQLCMD:-/opt/mssql-tools18/bin/sqlcmd}"
export COMPOSE_PROFILES=full   # để `compose exec` thấy mọi service

die() { echo "LỖI: $*" >&2; exit 1; }

[ -f "$COMPOSE_FILE" ] || die "không thấy $COMPOSE_FILE (hãy đứng ở gốc repo)."
[ -f "$ENV_REL" ] || die "chưa có $ENV_REL. Chạy: cp docker/.env.example $ENV_REL rồi điền DB_PASSWORD."

env_get() { grep -E "^$1=" "$ENV_REL" | tail -n1 | cut -d= -f2- | tr -d '\r' || true; }
DB_USER="$(env_get DB_USER)"; DB_USER="${DB_USER:-sa}"
DB_PASSWORD="$(env_get DB_PASSWORD)"
DB_NAME="$(env_get DB_NAME)"; DB_NAME="${DB_NAME:-ticket_system}"
ACTIVE_EVENT_ID="$(env_get ACTIVE_EVENT_ID)"; ACTIVE_EVENT_ID="${ACTIVE_EVENT_ID:-EV001}"

# sql "câu lệnh"  -> in kết quả: không tiêu đề, cột ngăn bởi '|', NULL in là NULL
sql() {
  "${COMPOSE[@]}" exec -T -e SQLCMDPASSWORD="$DB_PASSWORD" sqlserver \
    "$SQLCMD_BIN" -S localhost -U "$DB_USER" -d "$DB_NAME" -C -b -I -h -1 -W -s "|" -f 65001 \
    -Q "SET NOCOUNT ON; $1" | tr -d '\r'
}

require_stack() {
  "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx sqlserver \
    || die "SQL Server chưa chạy. Bật bằng: ./scripts/up.sh stream"
  [ "$(docker inspect -f '{{.State.Running}}' kafka 2>/dev/null || true)" = "true" ] \
    || die "Kafka chưa chạy. Bật bằng: ./scripts/up.sh stream"
}
