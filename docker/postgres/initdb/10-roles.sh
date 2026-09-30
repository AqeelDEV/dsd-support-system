#!/usr/bin/env bash
# Runs once, as the PostgreSQL superuser, when the data volume is first
# initialised. Creates the three login roles from ADR-0008 and the
# application database, owned by the migrator. Table privileges for the
# API and worker roles are granted table by table in migrations.
set -euo pipefail

psql --username "$POSTGRES_USER" --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --set migrator_password="$DSD_MIGRATOR_PASSWORD" \
  --set api_password="$DSD_API_PASSWORD" \
  --set worker_password="$DSD_WORKER_PASSWORD" \
  --set app_db="$DSD_DATABASE" <<'SQL'
CREATE ROLE dsd_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE dsd_api LOGIN PASSWORD :'api_password';
CREATE ROLE dsd_worker LOGIN PASSWORD :'worker_password';

CREATE DATABASE :"app_db" OWNER dsd_migrator;
REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"app_db" TO dsd_migrator, dsd_api, dsd_worker;

\connect :"app_db"
CREATE EXTENSION IF NOT EXISTS vector;
SQL
