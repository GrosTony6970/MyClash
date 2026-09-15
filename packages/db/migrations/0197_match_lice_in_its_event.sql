-- 0197: a Match is placed only on a Lice of its own Event.
--
-- THE DEFECT. `matches.lice_id` could reference any Lice in the database. Seven API doors wrote it
-- without looking at the Lice's Event: creating a Match, placing one, the Match update, Pool
-- generation, setting a Pool's Lice, moving a Pool, and the re-fan. A Tournament restored into
-- another Event also kept the source Event's Lice on every bout. Only the AI assistant and the
-- staff Lice assignments checked. A Match placed on another Event's Lice counts as an occupant
-- there, because the occupancy check reads every bout on a Lice whatever its Event, so it blocks
-- that Event's own placements and shows on its live board.
--
-- WHAT CHANGES. A trigger refuses an insert, or an update of `lice_id` or `phase_id`, that leaves a
-- Match on a Lice of another Event than its phase's Tournament. `matches` carries no `event_id`,
-- so neither a CHECK nor a composite foreign key can say it; the trigger walks phase → Tournament.
--
-- The API refuses first, at every door that takes a Lice id from its caller, through one function
-- (apps/api/src/modules/lices/lices-in-event.ts), so an organiser reads a plain message and a
-- write of several rows cannot half-apply. A Tournament restored into another Event recreates
-- there the Lices its bouts use. This is the guarantee underneath: it holds for every writer, the
-- service role included, and for any door added later.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table and no policy change. The function is SECURITY INVOKER and reads `lices`, `phases`
-- and `tournaments` as the writer; a writer who cannot see the Lice is refused, which fails closed.
-- The API writes through the service role, which sees every row.

create or replace function public.match_lice_in_its_event()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.lices l
    join public.tournaments t on t.event_id = l.event_id
    join public.phases p on p.tournament_id = t.id
    where l.id = new.lice_id
      and p.id = new.phase_id
  ) then
    raise exception 'A Match can only be placed on a Lice of its own Event'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.match_lice_in_its_event() is
  'BEFORE INSERT/UPDATE trigger on matches: refuses a Lice that belongs to another Event than the Match''s phase''s Tournament.';

-- Idempotent: drop-then-create survives a replay without a duplicate_object throw.
drop trigger if exists matches_lice_in_its_event on public.matches;

create trigger matches_lice_in_its_event
  before insert or update of lice_id, phase_id on public.matches
  for each row
  when (new.lice_id is not null)
  execute function public.match_lice_in_its_event();

-- Existing rows are not re-checked. Nothing is in production, and the operator wipes the stack
-- before each redeploy.
