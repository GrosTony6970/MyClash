-- 0156_admin_runtime_db_stats.sql
-- Read-only runtime DB stats for the super-admin Runtime Health card.
-- SECURITY DEFINER so it can read pg_stat_activity across all backends;
-- EXECUTE granted to service_role only (the API's service key).

create or replace function public.admin_runtime_db_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'maxConnections', current_setting('max_connections')::int,
    'connectionsByState', (
      select jsonb_build_object(
        'active',            count(*) filter (where state = 'active'),
        'idle',              count(*) filter (where state = 'idle'),
        'idleInTransaction', count(*) filter (where state = 'idle in transaction'),
        'total',             count(*)
      )
      from pg_stat_activity
      where datname = current_database()
    ),
    'longestQuerySeconds', coalesce((
      select ceil(extract(epoch from (now() - query_start)))::int
      from pg_stat_activity
      where datname = current_database()
        and state = 'active'
        and pid <> pg_backend_pid()
      order by query_start asc
      limit 1
    ), 0),
    'databaseSizeBytes', pg_database_size(current_database()),
    'cacheHitRatio', coalesce((
      select round((sum(blks_hit)::numeric / nullif(sum(blks_hit) + sum(blks_read), 0)), 4)
      from pg_stat_database
      where datname = current_database()
    ), 1),
    'uptimeSeconds', ceil(extract(epoch from (now() - pg_postmaster_start_time())))::int
  );
$$;

revoke all on function public.admin_runtime_db_stats() from public;
grant execute on function public.admin_runtime_db_stats() to service_role;
