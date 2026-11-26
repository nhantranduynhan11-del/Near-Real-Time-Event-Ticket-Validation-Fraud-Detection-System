#!/bin/bash
set -euo pipefail

SQLCMD="/opt/mssql-tools18/bin/sqlcmd"

echo "db-init: nạp init.sql..."
"$SQLCMD" -S "${DB_HOST_INTERNAL}","${DB_PORT}" -U "${DB_USER}" -P "${DB_PASSWORD}" -C -No -I \
    -i /scripts/init.sql

echo "db-init: nạp seed.sql..."
"$SQLCMD" -S "${DB_HOST_INTERNAL}","${DB_PORT}" -U "${DB_USER}" -P "${DB_PASSWORD}" -C -No -I \
    -i /scripts/seed.sql

SPARK_PASS="${SPARK_DB_PASSWORD:-${DB_PASSWORD_SPARK:-}}"
if [ -n "${DB_PASSWORD_API:-}" ] && [ -n "$SPARK_PASS" ]; then
    echo "db-init: nạp security.sql..."
    "$SQLCMD" -S "${DB_HOST_INTERNAL}","${DB_PORT}" -U "${DB_USER}" -P "${DB_PASSWORD}" -C -No -I \
        -v ApiPass="${DB_PASSWORD_API}" -v SparkPass="${SPARK_PASS}" \
        -i /scripts/security.sql
else
    echo "db-init: bỏ qua security.sql (cần điền DB_PASSWORD_API và SPARK_DB_PASSWORD trong docker/.env)."
fi

echo "db-init: hoàn tất, thoát."