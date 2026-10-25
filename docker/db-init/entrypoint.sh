#!/bin/bash
set -euo pipefail

SQLCMD="/opt/mssql-tools18/bin/sqlcmd"

echo "db-init: nạp init.sql..."
"$SQLCMD" -S "${DB_HOST_INTERNAL}","${DB_PORT}" -U "${DB_USER}" -P "${DB_PASSWORD}" -C -No -I \
    -i /scripts/init.sql

echo "db-init: nạp seed.sql..."
"$SQLCMD" -S "${DB_HOST_INTERNAL}","${DB_PORT}" -U "${DB_USER}" -P "${DB_PASSWORD}" -C -No -I \
    -i /scripts/seed.sql

echo "db-init: hoàn tất, thoát."
