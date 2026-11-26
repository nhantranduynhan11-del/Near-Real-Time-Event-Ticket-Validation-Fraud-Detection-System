#!/bin/bash
set -euo pipefail

SQLCMD="/opt/mssql-tools18/bin/sqlcmd"

API_USER="${DB_USER_API:-}"
API_PASS="${DB_PASSWORD_API:-}"

SPARK_USER="${SPARK_DB_USER:-}"
SPARK_PASS="${SPARK_DB_PASSWORD:-}"

# Validate API credentials.
if [[ -n "$API_USER" && -z "$API_PASS" ]] ||
   [[ -z "$API_USER" && -n "$API_PASS" ]]; then
    echo "ERROR: DB_USER_API and DB_PASSWORD_API must both be set or both be empty." >&2
    exit 1
fi

# Validate Spark credentials.
if [[ -n "$SPARK_USER" && -z "$SPARK_PASS" ]] ||
   [[ -z "$SPARK_USER" && -n "$SPARK_PASS" ]]; then
    echo "ERROR: SPARK_DB_USER and SPARK_DB_PASSWORD must both be set or both be empty." >&2
    exit 1
fi

# Validate dedicated login names.
if [[ -n "$API_USER" && "$API_USER" != "api_user" ]]; then
    echo "ERROR: DB_USER_API must be api_user." >&2
    exit 1
fi

if [[ -n "$SPARK_USER" && "$SPARK_USER" != "spark_user" ]]; then
    echo "ERROR: SPARK_DB_USER must be spark_user." >&2
    exit 1
fi

run_sql() {
    "$SQLCMD" \
        -S "${DB_HOST_INTERNAL},${DB_PORT}" \
        -U "${DB_USER}" \
        -P "${DB_PASSWORD}" \
        -C -No -I -b "$@"
}

echo "db-init: loading init.sql..."
run_sql -i /scripts/init.sql

echo "db-init: loading seed.sql..."
run_sql -i /scripts/seed.sql

# Initialize API account independently.
if [[ -n "$API_USER" && -n "$API_PASS" ]]; then
    echo "db-init: loading security_api.sql..."

    API_SQL_PASS="${API_PASS//\'/\'\'}"

    run_sql \
        -v ApiPass="$API_SQL_PASS" \
        -i /scripts/security_api.sql
else
    echo "db-init: API dedicated account disabled."
fi

# Initialize Spark account independently.
if [[ -n "$SPARK_USER" && -n "$SPARK_PASS" ]]; then
    echo "db-init: loading security_spark.sql..."

    SPARK_SQL_PASS="${SPARK_PASS//\'/\'\'}"

    run_sql \
        -v SparkPass="$SPARK_SQL_PASS" \
        -i /scripts/security_spark.sql
else
    echo "db-init: Spark dedicated account disabled."
fi

echo "db-init: completed successfully."
