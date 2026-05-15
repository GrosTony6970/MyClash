#!/bin/bash
# Realtime stores its internal Ecto migration tables in _realtime. Keep these
# objects out of public so they cannot collide with MyClash application tables.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=pguser="$POSTGRES_USER" <<'EOSQL'
CREATE SCHEMA IF NOT EXISTS _realtime;
ALTER SCHEMA _realtime OWNER TO :pguser;
EOSQL
