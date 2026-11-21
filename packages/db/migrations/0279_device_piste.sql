-- 0279 — the piste each scoring tablet has open (ruling 953).
--
-- Two volunteers can open the pad for the same piste on two tablets and both
-- score its bout. Nothing told anyone: duplicate hits are absorbed, and a clock
-- press that meets the other tablet's goes to Review. The ruling: warn both
-- sides, block nobody.
--
-- The pad's 20-second check-in already lands here, one row per device. It now
-- also says which piste the pad has open. Two devices that checked in from one
-- piste within the last minute are two tablets on it: the check-in's answer
-- tells each pad, and the Live board shows it on the piste's row.
--
-- NULL: a pad on no piste (the piste list, a desk), or one on an older bundle.
-- ON DELETE SET NULL: a deleted piste leaves its devices' history alone.

alter table public.scoring_device_sync_reports
  add column if not exists lice_id uuid references public.lices(id) on delete set null;

-- The board's read and the check-in's count: the devices of one Event heard
-- from lately, by piste.
create index if not exists scoring_device_sync_reports_event_lice_idx
  on public.scoring_device_sync_reports (event_id, lice_id, last_reported_at desc);

-- The upsert gains the piste. A new argument is a new signature: the old one
-- goes, so no caller can keep writing reports without a piste by accident.
drop function if exists public.record_device_sync_report(
  uuid, text, text, integer, text[], timestamptz
);

create or replace function public.record_device_sync_report(
  p_event_id              uuid,
  p_device_id             text,
  p_device_label          text,
  p_quarantined_count     integer,
  p_reason_codes          text[],
  p_oldest_quarantined_at timestamptz,
  p_lice_id               uuid
)
returns void
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  insert into public.scoring_device_sync_reports (
    event_id, device_id, device_label, quarantined_count,
    peak_quarantined_count, reason_codes, oldest_quarantined_at, last_reported_at, lice_id
  )
  values (
    p_event_id, p_device_id, p_device_label, p_quarantined_count,
    p_quarantined_count, coalesce(p_reason_codes, '{}'), p_oldest_quarantined_at, now(), p_lice_id
  )
  on conflict (event_id, device_id) do update
    set device_label           = coalesce(excluded.device_label,
                                          public.scoring_device_sync_reports.device_label),
        quarantined_count      = excluded.quarantined_count,
        peak_quarantined_count = greatest(
                                   public.scoring_device_sync_reports.peak_quarantined_count,
                                   excluded.quarantined_count),
        reason_codes           = (
                                   select coalesce(array_agg(distinct code order by code), '{}')
                                   from unnest(
                                     public.scoring_device_sync_reports.reason_codes
                                     || excluded.reason_codes
                                   ) as code
                                 ),
        oldest_quarantined_at  = least(
                                   public.scoring_device_sync_reports.oldest_quarantined_at,
                                   excluded.oldest_quarantined_at),
        last_reported_at       = now(),
        -- The piste open NOW: a tablet that moved to another piste, or back to
        -- the list, leaves the first one at its next check-in.
        lice_id                = excluded.lice_id;
$$;

revoke all on function public.record_device_sync_report(
  uuid, text, text, integer, text[], timestamptz, uuid
) from public;
revoke execute on function public.record_device_sync_report(
  uuid, text, text, integer, text[], timestamptz, uuid
) from anon, authenticated;
grant execute on function public.record_device_sync_report(
  uuid, text, text, integer, text[], timestamptz, uuid
) to service_role;

notify pgrst, 'reload schema';
