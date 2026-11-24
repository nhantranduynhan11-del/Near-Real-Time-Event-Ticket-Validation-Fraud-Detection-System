#!/usr/bin/env bash
# Sao lưu toàn bộ database vào database/backup/ (thư mục đã gắn ra ngoài container).
# Dùng:  scripts/backup_db.sh [tên_tệp.bak]     mặc định: ticket_system_<ngày_giờ>.bak
# Cần SQL Server đang chạy (docker compose --profile app up -d sqlserver).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$ROOT/docker/docker-compose.yml}
BACKUP_DIR=${BACKUP_DIR:-$ROOT/database/backup}
CONTAINER_DIR=/var/opt/mssql/backup
DB_NAME=${DB_NAME:-ticket_system}
FILE=${1:-${DB_NAME}_$(date +%Y%m%d_%H%M%S).bak}

[[ $FILE =~ ^[A-Za-z0-9._-]+\.bak$ ]] || { echo "Tên tệp chỉ gồm chữ, số, dấu . _ - và phải kết thúc bằng .bak" >&2; exit 1; }

sql_master() {
  docker compose -f "$COMPOSE_FILE" exec -T sqlserver bash -c \
    '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -I -b -d master'
}

mkdir -p "$BACKUP_DIR"
chmod 777 "$BACKUP_DIR"

start=$(date +%s%3N)
sql_master <<SQL
BACKUP DATABASE [$DB_NAME] TO DISK = N'$CONTAINER_DIR/$FILE' WITH FORMAT, INIT, COMPRESSION, CHECKSUM, STATS = 25;
GO
RESTORE VERIFYONLY FROM DISK = N'$CONTAINER_DIR/$FILE' WITH CHECKSUM;
GO
SQL
end=$(date +%s%3N)

ms=$((end - start))
size=$(stat -c %s "$BACKUP_DIR/$FILE" 2>/dev/null || echo 0)
echo "Sao lưu xong: $BACKUP_DIR/$FILE"
printf 'Dung lượng tệp: %d.%02d MB\n' $((size / 1048576)) $(((size % 1048576) * 100 / 1048576))
printf 'Thời gian sao lưu (gồm kiểm tra tệp): %d.%03d giây\n' $((ms / 1000)) $((ms % 1000))
