#!/usr/bin/env bash
# Demo quy trình sao lưu -> giả lập sự cố (xóa dữ liệu hoặc xóa DB) -> khôi phục -> đối chiếu số dòng.
# Dùng:  scripts/demo_backup_restore.sh [--yes]
#        DISASTER=drop scripts/demo_backup_restore.sh --yes
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$ROOT/docker/docker-compose.yml}
ENV_FILE=${ENV_FILE:-$ROOT/docker/.env}
DB_NAME=${DB_NAME:-ticket_system}
DISASTER=${DISASTER:-delete}
LOG=${LOG:-$ROOT/docs/backup_restore_log.txt}
TABLES=(event gate event_gate gate_travel_time scanner app_user ticket scan_event fraud_alert gold_gate_stats gold_event_stats gold_alert)

mkdir -p "$(dirname "$LOG")"
log() { printf '%s\n' "$*" | tee -a "$LOG"; }

sql_in() { # sql_in DB  (SQL đọc từ stdin)
  COMPOSE_PROFILES=full docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T sqlserver bash -c \
    '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -I -b -d "$0"' "$1"
}

count_rows() { # in "bảng|số_dòng", đã sắp xếp
  local t sql="SET NOCOUNT ON;"$'\n' first=1
  for t in "${TABLES[@]}"; do
    (( first )) || sql+="UNION ALL "
    sql+="SELECT N'$t|' + CAST(COUNT(*) AS NVARCHAR(20)) FROM dbo.[$t]"$'\n'
    first=0
  done
  COMPOSE_PROFILES=full docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T sqlserver bash -c \
    '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -I -b -d "$0" -h -1 -W' "$DB_NAME" \
    <<<"$sql" | grep '|' | sort
}

ms_since() { echo $(( $(( $(date +%s%N) / 1000000 )) - $1 )); }
fmt_ms() { printf '%d.%03d giây' $(($1 / 1000)) $(($1 % 1000)); }

if [[ ${1:-} != --yes ]]; then
  read -r -p "Script sẽ XÓA toàn bộ dữ liệu của $DB_NAME (sau khi đã sao lưu). Gõ yes để tiếp tục: " ans
  [[ $ans == yes ]] || { echo "Đã hủy."; exit 1; }
fi

BACKUP="${DB_NAME}_demo_$(date +%Y%m%d_%H%M%S).bak"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

log "=============================================================="
log "Demo sao lưu và khôi phục: $(date '+%Y-%m-%d %H:%M:%S')  máy: $(hostname)"
log "Database: $DB_NAME   Kiểu sự cố: $DISASTER   Tệp sao lưu: $BACKUP"

log ""
log "Bước 1. Đếm số dòng các bảng trước khi sao lưu"
count_rows > "$TMP/before.txt"
tr '|' ' ' < "$TMP/before.txt" | awk '{printf "  %-20s %10s\n", $1, $2; total += $2} END {printf "  %-20s %10d\n", "TỔNG", total}' | tee -a "$LOG"

log ""
log "Bước 2. Sao lưu"
t0=$(( $(date +%s%N) / 1000000 ))
bash "$ROOT/scripts/backup_db.sh" "$BACKUP" | tee -a "$LOG"
backup_ms=$(ms_since "$t0")

log ""
log "Bước 3. Giả lập sự cố: $DISASTER"
if [[ $DISASTER == drop ]]; then
  sql_in master <<SQL
ALTER DATABASE [$DB_NAME] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
GO
DROP DATABASE [$DB_NAME];
GO
SQL
  log "  Đã xóa hẳn database $DB_NAME."
else
  sql_in "$DB_NAME" <<'SQL'
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DELETE FROM dbo.gold_alert;
DELETE FROM dbo.fraud_alert;
DELETE FROM dbo.scan_event;
DELETE FROM dbo.gold_gate_stats;
DELETE FROM dbo.gold_event_stats;
DELETE FROM dbo.ticket;
DELETE FROM dbo.scanner;
DELETE FROM dbo.gate_travel_time;
DELETE FROM dbo.event_gate;
DELETE FROM dbo.app_user;
DELETE FROM dbo.gate;
DELETE FROM dbo.[event];
COMMIT TRANSACTION;
GO
SQL
  count_rows > "$TMP/disaster.txt"
  remaining=$(awk -F'|' '{t += $2} END {print t + 0}' "$TMP/disaster.txt")
  log "  Sau khi xóa, tổng số dòng còn lại: $remaining (phải là 0)"
fi

log ""
log "Bước 4. Khôi phục"
t0=$(( $(date +%s%N) / 1000000 ))
bash "$ROOT/scripts/restore_db.sh" "$BACKUP" | tee -a "$LOG"
restore_ms=$(ms_since "$t0")

log ""
log "Bước 5. Đếm lại và so khớp với bước 1"
count_rows > "$TMP/after.txt"
fail=0
printf '  %-20s %10s %10s  %s\n' "Bảng" "Trước" "Sau" "Kết quả" | tee -a "$LOG"
while IFS='|' read -r table before after; do
  if [[ $before == "$after" ]]; then verdict="Khớp"; else verdict="LỆCH"; fail=1; fi
  printf '  %-20s %10s %10s  %s\n' "$table" "$before" "$after" "$verdict" | tee -a "$LOG"
done < <(join -t'|' "$TMP/before.txt" "$TMP/after.txt")

log ""
log "Thời gian sao lưu : $(fmt_ms "$backup_ms")"
log "Thời gian khôi phục: $(fmt_ms "$restore_ms")"
if (( fail == 0 )); then
  log "KẾT LUẬN: số dòng của cả ${#TABLES[@]} bảng khớp hoàn toàn trước và sau khôi phục."
else
  log "KẾT LUẬN: CÓ BẢNG LỆCH SỐ DÒNG, khôi phục chưa đạt."
  exit 1
fi
