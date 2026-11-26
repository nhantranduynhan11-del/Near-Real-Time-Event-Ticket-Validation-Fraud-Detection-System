#!/usr/bin/env bash
# Khôi phục database từ một tệp .bak trong database/backup/.
# Dùng:  scripts/restore_db.sh [tệp.bak]     mặc định: tệp .bak mới nhất
# GHI ĐÈ database hiện có. Mọi kết nối đang mở (API, Spark) bị ngắt, nên khởi động lại chúng sau đó.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$ROOT/docker/docker-compose.yml}
ENV_FILE=${ENV_FILE:-$ROOT/docker/.env}
BACKUP_DIR=${BACKUP_DIR:-$ROOT/database/backup}
CONTAINER_DIR=/var/opt/mssql/backup
DB_NAME=${DB_NAME:-ticket_system}

if [[ $# -ge 1 ]]; then
  FILE=$1
else
  FILE=$({ ls -t "$BACKUP_DIR"/*.bak 2>/dev/null || true; } | head -n 1 | xargs -r basename)
fi
[[ -n ${FILE:-} ]] || { echo "Không có tệp .bak nào trong $BACKUP_DIR" >&2; exit 1; }
[[ $FILE =~ ^[A-Za-z0-9._-]+\.bak$ ]] || { echo "Tên tệp không hợp lệ: $FILE" >&2; exit 1; }
[[ -f $BACKUP_DIR/$FILE ]] || { echo "Không thấy $BACKUP_DIR/$FILE" >&2; exit 1; }
chmod a+r "$BACKUP_DIR/$FILE" 2>/dev/null || true

compose() {
  local args=(-f "$COMPOSE_FILE")
  [[ -f $ENV_FILE ]] && args+=(--env-file "$ENV_FILE")
  COMPOSE_PROFILES=${COMPOSE_PROFILES:-full} docker compose "${args[@]}" "$@"
}

# shellcheck disable=SC2016
sql_master() {
  compose exec -T sqlserver bash -c \
    '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -I -b -d master'
}

echo "Khôi phục từ $FILE ..."
start=$(date +%s%3N)
sql_master <<SQL
RESTORE VERIFYONLY FROM DISK = N'$CONTAINER_DIR/$FILE' WITH CHECKSUM;
GO
IF DB_ID(N'$DB_NAME') IS NOT NULL ALTER DATABASE [$DB_NAME] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
GO
BEGIN TRY
    RESTORE DATABASE [$DB_NAME] FROM DISK = N'$CONTAINER_DIR/$FILE' WITH REPLACE, RECOVERY, STATS = 25;
END TRY
BEGIN CATCH
    IF DB_ID(N'$DB_NAME') IS NOT NULL AND DATABASEPROPERTYEX(N'$DB_NAME', 'Status') = N'ONLINE'
        ALTER DATABASE [$DB_NAME] SET MULTI_USER;
    THROW;
END CATCH
GO
ALTER DATABASE [$DB_NAME] SET MULTI_USER;
GO
SQL
end=$(date +%s%3N)

ms=$((end - start))
echo "Khôi phục xong."
printf 'Thời gian khôi phục (gồm kiểm tra tệp): %d.%03d giây\n' $((ms / 1000)) $((ms % 1000))
echo "Nhớ khởi động lại API và Spark vì kết nối cũ đã bị ngắt."
