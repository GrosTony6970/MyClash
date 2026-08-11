-- 0182_scoring_device_sync_reports.sql
-- A DURABLE record of what scoring devices failed to deliver during an event.
--
-- What already exists, so this does not duplicate it: `staff/heartbeat` sends
-- `rejectedCount` on a timer and `recordHeartbeat` writes it to
-- `event_staff_accounts.rejected_count`, feeding the live control-room board.
-- That column is a GAUGE — overwritten on every heartbeat, carrying no reason,
-- living on a row scoped to a staff account that is deleted between events and
-- excluded from the archive. It answers "is a tablet stuck right now".
--
-- It cannot answer the question a post-event report asks: did anything fail to
-- reach us today, and why. A device that was stuck at 14:00 and synced clean by
-- 17:00 reports 0 at the end, and the three exchanges a referee actually scored
-- and had refused leave no trace at all. So this table records the HIGH-WATER
-- mark and the reason codes, both of which only ever grow within an event.
--
-- Keyed by (event_id, device_id) rather than per exchange, and written on EVERY
-- sync including clean ones, so a device nobody heard from is distinguishable
-- from a device with nothing to report. device_id is a client-generated opaque
-- id, stable per browser profile — a tablet is shared, borrowed and re-lent all
-- day, so it names a device, never a person.
--
-- Reasons are a CLOSED CODE SET mapped on the device, never the server's own
-- message: a 400 body can embed the offending value (a 23505 carries
-- `Key (email)=(…)`), and this repo is public — hard rule 7.

create table public.scoring_device_sync_reports (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references public.events(id) on delete cascade,
  device_id             text not null,
  -- Human label from the device picker, when the volunteer set one.
  device_label          text,
  -- Still held at the last report. Falls back to 0 when a device drains.
  quarantined_count     integer not null default 0 check (quarantined_count >= 0),
  -- The most this device ever held during the event. NEVER decreases — this is
  -- the column the post-event report reads, because a device that recovered
  -- still had exchanges refused and that is the finding.
  peak_quarantined_count integer not null default 0 check (peak_quarantined_count >= 0),
  -- Union of every code seen during the event, not just the current ones.
  reason_codes          text[] not null default '{}',
  -- When the oldest still-held exchange was refused. NULL once none are held.
  oldest_quarantined_at timestamptz,
  -- Written on every sync, clean or not. A stale value means the device stopped
  -- talking, which is its own finding.
  last_reported_at      timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (event_id, device_id)
);

comment on table public.scoring_device_sync_reports is
  'Durable per-device record of exchanges the server refused during an event. '
  'peak_quarantined_count only grows, so a device that recovered still shows '
  'that something was refused; event_staff_accounts.rejected_count remains the '
  'live gauge for the control-room board.';

create index if not exists scoring_device_sync_reports_event_idx
  on public.scoring_device_sync_reports (event_id, last_reported_at desc);

-- Deny-all: PostgREST exposes `public` as `anon`, so a table without RLS is
-- world-readable. Only the service role (which bypasses RLS) touches this.
alter table public.scoring_device_sync_reports enable row level security;

/*
 * The upsert, as a function because the merge is not expressible as one.
 *
 * peak_quarantined_count takes greatest(old, new) and reason_codes takes the
 * union, so out-of-order reports from a flaky link cannot walk the record
 * backwards — which is the entire reason this table exists rather than reading
 * the live gauge. SECURITY DEFINER with a pinned search_path, EXECUTE to
 * service_role only, mirroring record_query_error (0180).
 */
create or replace function public.record_device_sync_report(
  p_event_id              uuid,
  p_device_id             text,
  p_device_label          text,
  p_quarantined_count     integer,
  p_reason_codes          text[],
  p_oldest_quarantined_at timestamptz
)
returns void
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  insert into public.scoring_device_sync_reports (
    event_id, device_id, device_label, quarantined_count,
    peak_quarantined_count, reason_codes, oldest_quarantined_at, last_reported_at
  )
  values (
    p_event_id, p_device_id, p_device_label, p_quarantined_count,
    p_quarantined_count, coalesce(p_reason_codes, '{}'), p_oldest_quarantined_at, now()
  )
  on conflict (event_id, device_id) do update
    set device_label           = coalesce(excluded.device_label,
                                          public.scoring_device_sync_reports.device_label),
        quarantined_count      = excluded.quarantined_count,
        peak_quarantined_count = greatest(
                                   public.scoring_device_sync_reports.peak_quarantined_count,
                                   excluded.quarantined_count),
        -- Union, de-duplicated and ordered so the column is comparable across
        -- reports rather than depending on arrival order.
        reason_codes           = (
                                   select coalesce(array_agg(distinct code order by code), '{}')
                                   from unnest(
                                     public.scoring_device_sync_reports.reason_codes
                                     || excluded.reason_codes
                                   ) as code
                                 ),
        -- The EARLIEST refusal ever seen; a later report holding nothing must
        -- not erase when the trouble started.
        oldest_quarantined_at  = least(
                                   public.scoring_device_sync_reports.oldest_quarantined_at,
                                   excluded.oldest_quarantined_at),
        last_reported_at       = now();
$$;

revoke all on function public.record_device_sync_report(
  uuid, text, text, integer, text[], timestamptz
) from public;
grant execute on function public.record_device_sync_report(
  uuid, text, text, integer, text[], timestamptz
) to service_role;
