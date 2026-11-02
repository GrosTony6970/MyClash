#!/usr/bin/env bash
# CI, Deploy migration run (rulings 390-399): each Supabase service logs in as its own database
# user, on the prod compose file with .env.example, after the deploy's migrations ran on a FRESH
# database. Ownership proves the login only on a fresh database: a table records who CREATED it.
#
# Every assertion can fail on a URL put back on the superuser, and none passes on an empty set:
#   - GoTrue: every table in `auth` is owned by supabase_auth_admin, and there are more than the
#     image's 5 (so GoTrue's own migrations ran under its login);
#   - Storage: storage.buckets and storage.objects exist and are owned by supabase_storage_admin;
#   - PostgREST: at least one client backend from its address is `authenticator` (its lifelong
#     LISTEN connection), none is supabase_admin.
# Plus: each narrow user logs in over the docker network with its own password and is refused
# with POSTGRES_PASSWORD; none is superuser or BYPASSRLS; GoTrue owns every `auth` function
# (0248); service_role carries a 60 s statement limit and no lock limit of its own (395, 398).
# And the database console (meta, Studio) cannot be reached from `myclash`, by name or by
# address, while Studio's own SQL route still works (ruling 396).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

set -a
# shellcheck source=/dev/null
source .env.example
set +a
# deploy.sh's own guard (mc_require_service_role_passwords) and the err() it prints with.
# shellcheck source=../infra/scripts/lib/log.sh
source infra/scripts/lib/log.sh
# shellcheck source=../infra/scripts/lib/database-url.sh
source infra/scripts/lib/database-url.sh
compose=(docker compose --env-file .env.example -f infra/docker-compose.prod.yml)
DB_IMAGE=$(docker inspect -f '{{.Config.Image}}' myclash-db)
failed=0
red() {
  echo "RED $*"
  failed=1
}
ok() { echo "ok  $*"; }
sql() { docker exec myclash-db psql -h 127.0.0.1 -U supabase_admin -d "$POSTGRES_DB" -Atc "$1"; }
ip_on_myclash() { docker inspect -f '{{(index .NetworkSettings.Networks "myclash").IPAddress}}' "$1"; }

echo "--- the database is fresh: GoTrue and Storage have not created their tables yet"
existing=$(sql "select coalesce(string_agg(t, ' '), '') from (select to_regclass('auth.sessions')::text as t union all select to_regclass('storage.buckets')::text) x where t is not null")
if [[ -n "$existing" ]]; then
  echo "RED already there before the services start ($existing): ownership would prove nothing"
  exit 1
fi
ok "neither auth.sessions nor storage.buckets exists yet"

"${compose[@]}" up -d supabase-auth supabase-rest supabase-storage

echo "--- traffic through every service"
if ! "${compose[@]}" run --rm --no-deps -v "$PWD/scripts:/check:ro" api \
  node /check/check-service-db-users.mjs; then
  red "the HTTP checks"
fi

echo "--- who logged in"
read -r auth_total auth_foreign < <(sql "select count(*), count(*) filter (where pg_get_userbyid(c.relowner) <> 'supabase_auth_admin') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relkind in ('r','p')" | tr '|' ' ')
if [[ "$auth_total" -gt 5 && "$auth_foreign" -eq 0 ]]; then
  ok "GoTrue: all $auth_total auth tables are supabase_auth_admin's"
else
  red "GoTrue: $auth_foreign of $auth_total auth tables are not supabase_auth_admin's (need >5, 0)"
fi
storage_owners=$(sql "select string_agg(c.relname || '=' || pg_get_userbyid(c.relowner), ' ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname in ('buckets','objects')")
if [[ "$storage_owners" == "buckets=supabase_storage_admin objects=supabase_storage_admin" ]]; then
  ok "Storage: $storage_owners"
else
  red "Storage: '$storage_owners' (want buckets and objects owned by supabase_storage_admin)"
fi
rest_ip=$(ip_on_myclash myclash-supabase-rest 2>/dev/null || true)
rest_auth=0
rest_su=0
if [[ -n "$rest_ip" ]]; then
  read -r rest_auth rest_su < <(sql "select count(*) filter (where usename = 'authenticator'), count(*) filter (where usename = 'supabase_admin') from pg_stat_activity where backend_type = 'client backend' and client_addr = '$rest_ip'" | tr '|' ' ')
fi
if [[ -z "$rest_ip" ]]; then
  red "PostgREST has no address on network myclash (not running)"
elif [[ "$rest_auth" -ge 1 && "$rest_su" -eq 0 ]]; then
  ok "PostgREST ($rest_ip): $rest_auth authenticator backend(s), no supabase_admin"
else
  red "PostgREST ($rest_ip): $rest_auth authenticator, $rest_su supabase_admin backends (need >=1, 0)"
fi

echo "--- logins over the docker network"
login() { # user password -> exit status of a TCP login to db
  docker run --rm --network myclash -e PGPASSWORD="$2" -e PGCONNECT_TIMEOUT=5 \
    --entrypoint psql "$DB_IMAGE" -h db -U "$1" -d "$POSTGRES_DB" -Atc 'select 1' >/dev/null 2>&1
}
if login authenticator wrong-password-on-purpose; then
  red "a wrong password logged in: this path proves nothing"
else
  ok "a wrong password is refused on this path"
fi
for pair in authenticator:AUTHENTICATOR_PASSWORD supabase_auth_admin:SUPABASE_AUTH_ADMIN_PASSWORD \
  supabase_storage_admin:SUPABASE_STORAGE_ADMIN_PASSWORD; do
  user=${pair%%:*}
  key=${pair#*:}
  if login "$user" "${!key}"; then
    ok "$user logs in with $key"
  else
    red "$user cannot log in with $key"
  fi
  if login "$user" "$POSTGRES_PASSWORD"; then
    red "$user logs in with POSTGRES_PASSWORD"
  else
    ok "$user is refused with POSTGRES_PASSWORD"
  fi
done

echo "--- deploy.sh's guard passes on this fresh database"
if mc_require_service_role_passwords "${compose[@]}"; then
  ok "mc_require_service_role_passwords: every service user has its password"
else
  red "mc_require_service_role_passwords refused a fresh database"
fi

echo "--- roles and settings"
powers=$(sql "select string_agg(rolname, ' ') from pg_roles where rolname in ('authenticator','supabase_auth_admin','supabase_storage_admin') and (rolsuper or rolbypassrls)")
if [[ -z "$powers" ]]; then
  ok "no narrow user is superuser or BYPASSRLS"
else
  red "superuser or BYPASSRLS: $powers"
fi
# Stated, not asserted away: the image gives the two admin users CREATEROLE.
echo "    CREATEROLE (from the image): $(sql "select string_agg(rolname, ' ') from pg_roles where rolname in ('authenticator','supabase_auth_admin','supabase_storage_admin') and rolcreaterole")"
auth_fn=$(sql "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and pg_get_userbyid(p.proowner) <> 'supabase_auth_admin'")
if [[ "$auth_fn" == 0 ]]; then
  ok "every auth function is supabase_auth_admin's (0248)"
else
  red "$auth_fn auth function(s) not owned by supabase_auth_admin"
fi
settings=$(sql "select coalesce(array_to_string(s.setconfig, ' '), '') from pg_roles r left join pg_db_role_setting s on s.setrole = r.oid and s.setdatabase = 0 where r.rolname = 'service_role'")
if [[ " $settings " == *" statement_timeout=60s "* && "$settings" != *lock_timeout* ]]; then
  ok "service_role: $settings"
else
  red "service_role settings '$settings' (want statement_timeout=60s and no lock_timeout)"
fi

echo "--- the database console's own network (ruling 396)"
if ! "${compose[@]}" up -d --wait supabase-meta supabase-studio >/dev/null 2>&1; then
  red "supabase-meta and supabase-studio did not come up healthy"
  "${compose[@]}" ps supabase-meta supabase-studio || true
  for c in myclash-supabase-meta myclash-supabase-studio; do
    # A container that was never created must not end the report here (set -e, pipefail).
    docker inspect -f '{{json .State.Health.Log}}' "$c" 2>/dev/null | tail -c 600 || true
    echo
  done
fi
# An address, or empty: `docker inspect` can print "<no value>" for a network it does not have.
ip_on_dbadmin() {
  local ip
  ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "myclash-dbadmin").IPAddress}}' "$1" 2>/dev/null || true)
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && echo "$ip"
  return 0
}
meta_ip=$(ip_on_dbadmin myclash-supabase-meta)
studio_ip=$(ip_on_dbadmin myclash-supabase-studio)
if [[ -z "$meta_ip" || -z "$studio_ip" ]]; then
  red "meta ($meta_ip) or Studio ($studio_ip) has no address on myclash-dbadmin"
fi
# From `myclash`, where GoTrue, PostgREST, Storage and the api live: by name and by address.
# PostgREST is the control: it IS on myclash, so it must answer from this same container. The
# address leg only shows that docker keeps two bridges apart; the name leg is what a service on
# the wrong network turns red.
if ! "${compose[@]}" run --rm --no-deps -v "$PWD/scripts:/check:ro" api \
  node /check/check-service-db-users.mjs unreachable http://supabase-rest:3000/ \
  http://supabase-meta:8080/health http://supabase-studio:3000/api/platform/profile \
  "http://${meta_ip:-0.0.0.0}:8080/health" "http://${studio_ip:-0.0.0.0}:3000/api/platform/profile"; then
  red "the database console answers from network myclash"
fi
# From Studio itself, its SQL route still reaches meta and the database.
if docker exec myclash-supabase-studio node -e 'fetch("http://localhost:3000/api/platform/pg-meta/default/query",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:"select 1 as one"})}).then(async r=>{const t=await r.text();process.exit(r.status===200&&t.includes("one")?0:1)}).catch(()=>process.exit(1))'; then
  ok "Studio's SQL route reaches meta and the database"
else
  red "Studio's SQL route does not reach meta"
fi

if [[ "$failed" -ne 0 ]]; then
  echo "SERVICE DB USERS: RED"
  exit 1
fi
echo "SERVICE DB USERS: GREEN"
