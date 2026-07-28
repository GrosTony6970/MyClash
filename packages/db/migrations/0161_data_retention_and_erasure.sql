-- 0161_data_retention_and_erasure.sql
-- GDPR: erasure marker, accountability receipt, and retention policy.
--
-- Three pieces:
--   1. global_persons.account_deleted_at — marks a profile whose account was
--      erased. Deliberately NOT reusing deleted_at (see below).
--   2. erasure_log — Art. 5(2) accountability, holding no personal data.
--   3. data_retention_settings — UI-editable sweep horizons for the worker.

-- ── 1. Erasure marker on global_persons ──────────────────────────────────────
--
-- `deleted_at` already belongs to the MERGE feature: merge.service sets it when
-- a duplicate profile is merged away, nulls it on revert, and refuses to merge
-- into a row that carries it. fighters.service also excludes deleted_at rows
-- from the import dedup candidate pool — so reusing that column for erasure
-- would make an erased person stop matching on re-import and silently spawn a
-- duplicate profile at their next event, as well as barring them as a merge
-- target. Erasure gets its own column; the two states are independent and a row
-- can legitimately be in both.
alter table public.global_persons
  add column if not exists account_deleted_at timestamptz;

comment on column public.global_persons.account_deleted_at is
  'Set when the linked user account was erased. Names and results are retained '
  '(published competition results are a public record, GDPR Art. 17(3)); the '
  'profile extras are nulled. Distinct from deleted_at, which means "merged away".';

create index if not exists idx_global_persons_account_deleted_at
  on public.global_persons (account_deleted_at)
  where account_deleted_at is not null;

-- ── 2. Erasure receipt ───────────────────────────────────────────────────────
--
-- Records THAT an erasure happened, never WHO it happened to: the subject is
-- gone, so a user FK would be both dangling and self-defeating. subject_hash is
-- sha256 of the deleted auth uid, which lets us answer "was this account
-- erased, and when" if the person asks again, without retaining an identifier.
create table if not exists public.erasure_log (
  id              uuid primary key default gen_random_uuid(),
  subject_hash    text not null,
  kind            text not null default 'account_deletion'
                    check (kind in ('account_deletion', 'admin_anonymisation')),
  redacted_tables jsonb not null default '{}'::jsonb,
  -- sha256 of the slug an anonymisation rotated away from, so the old public URL
  -- can answer 410 Gone instead of 404. Storing the slug itself would retain the
  -- person's name (slugs are `given-family-<suffix>`), which is the whole thing
  -- the anonymisation exists to remove; a hash answers "was this slug retired"
  -- without being readable. NULL for ordinary account deletion, which does not
  -- rotate the slug at all.
  previous_slug_hash text,
  executed_at     timestamptz not null default now()
);

create index if not exists idx_erasure_log_subject_hash on public.erasure_log (subject_hash);
create index if not exists idx_erasure_log_executed_at  on public.erasure_log (executed_at desc);
create index if not exists idx_erasure_log_previous_slug_hash
  on public.erasure_log (previous_slug_hash)
  where previous_slug_hash is not null;

alter table public.erasure_log enable row level security;
-- No policies: only the service_role (BYPASSRLS) may read/write. Without RLS
-- enabled this would be world-readable through PostgREST as `anon`.

-- ── 3. Retention policy ──────────────────────────────────────────────────────
--
-- Singleton config row, mirroring runtime_health_alert_settings (0157).
-- 0 means "keep forever" for every horizon.
--
-- audit_log defaults to 0 ON PURPOSE. It is a governance record as much as
-- personal data, and sweeping it would destroy history about people who never
-- asked for erasure. Personal data inside audit payloads is handled by
-- redaction-on-erasure instead, which removes the PII while keeping the trail.
create table if not exists public.data_retention_settings (
  setting_key                     text primary key default 'default',
  enabled                         boolean not null default true,
  guest_session_days              int not null default 90  check (guest_session_days >= 0),
  ai_usage_log_days               int not null default 365 check (ai_usage_log_days >= 0),
  broadcast_recipient_days        int not null default 365 check (broadcast_recipient_days >= 0),
  audit_log_days                  int not null default 0   check (audit_log_days >= 0),
  last_run_at                     timestamptz,
  last_run_removed                jsonb not null default '{}'::jsonb,
  updated_at                      timestamptz not null default now(),
  updated_by                      uuid
);

alter table public.data_retention_settings enable row level security;
-- No policies: service_role only, same reasoning as erasure_log.

insert into public.data_retention_settings (setting_key) values ('default')
on conflict (setting_key) do nothing;

-- ── 4. Audit payload index ───────────────────────────────────────────────────
--
-- Erasure has to find audit rows that reference the subject inside payload_json,
-- not just via actor_user_id. Without this that is a sequential scan of the
-- whole audit log on every account deletion. jsonb_path_ops is the smaller,
-- faster choice here: we only ever ask containment questions (@>).
create index if not exists idx_audit_log_payload_gin
  on public.audit_log using gin (payload_json jsonb_path_ops);
