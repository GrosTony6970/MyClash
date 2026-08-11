-- 0180_query_error_events.sql
-- The swallowed-error tripwire's store: PostgREST errors the API saw but a
-- caller may have rendered as "no data". RLS deny-all (service_role bypasses).
--
-- AGGREGATED, not a log. Rows are keyed by a fingerprint of the SANITISED
-- request, so a query failing in a loop increments one counter instead of
-- filling the disk. That bound is the reason the sanitiser is not optional:
-- an unsanitised message embeds the offending VALUE (a 23505 body carries
-- `Key (email)=(someone@example.com)`), which would mint a fresh fingerprint
-- per value and destroy both the bound and hard rule 7.

create table public.query_error_events (
  id                 uuid primary key default gen_random_uuid(),
  -- sha256 of method + table + status + code + sanitised message. UNIQUE, so
  -- the increment below is a single upsert with no read-modify-write race.
  fingerprint        text not null unique,
  method             text not null,
  -- The PostgREST resource: a table name, or the function name when is_rpc.
  table_name         text not null,
  is_rpc             boolean not null default false,
  status             int not null,
  -- PostgREST/Postgres error code (42703, PGRST200, …). Null when the body was
  -- not JSON — a Traefik HTML 502 has no code, and that is worth recording too.
  pg_code            text,
  severity           text not null check (severity in ('error', 'warning')),
  sanitized_path     text not null,
  sanitized_message  text,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  occurrence_count   bigint not null default 1 check (occurrence_count > 0),
  -- Set when an operator marks the row handled. A recurrence CLEARS it (see
  -- the function below): a fingerprint that comes back is not still resolved.
  resolved_at        timestamptz
);

alter table public.query_error_events enable row level security;
-- No policies: only the service_role (BYPASSRLS) may read/write. Without RLS
-- enabled PostgREST would expose this to `anon`, and it names internal tables
-- and column shapes.

-- The unresolved feed, newest activity first — the platform log's read.
create index query_error_events_unresolved_idx
  on public.query_error_events (last_seen_at desc)
  where resolved_at is null;

/*
 * Record one occurrence.
 *
 * A function rather than a PostgREST upsert because `upsert()` can only send
 * `Prefer: resolution=merge-duplicates`, which ASSIGNS the payload's columns —
 * it cannot express `occurrence_count + 1`. Through PostgREST the counter would
 * sit at 1 forever and, worse, `resolved_at` would never clear, so a resolved
 * fingerprint that started failing again would never return to the feed.
 *
 * SECURITY DEFINER with a pinned search_path, EXECUTE to service_role only,
 * mirroring admin_runtime_db_stats (0156).
 */
create or replace function public.record_query_error(
  p_fingerprint       text,
  p_method            text,
  p_table_name        text,
  p_is_rpc            boolean,
  p_status            int,
  p_pg_code           text,
  p_severity          text,
  p_sanitized_path    text,
  p_sanitized_message text
)
returns void
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  insert into public.query_error_events (
    fingerprint, method, table_name, is_rpc, status,
    pg_code, severity, sanitized_path, sanitized_message
  )
  values (
    p_fingerprint, p_method, p_table_name, p_is_rpc, p_status,
    p_pg_code, p_severity, p_sanitized_path, p_sanitized_message
  )
  on conflict (fingerprint) do update
    set occurrence_count = public.query_error_events.occurrence_count + 1,
        last_seen_at     = now(),
        -- A recurrence un-resolves the row. Silence must be earned each time.
        resolved_at      = null;
$$;

revoke all on function public.record_query_error(
  text, text, text, boolean, int, text, text, text, text
) from public;
grant execute on function public.record_query_error(
  text, text, text, boolean, int, text, text, text, text
) to service_role;
