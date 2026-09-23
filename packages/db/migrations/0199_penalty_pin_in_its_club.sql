-- 0199: an Event or a Tournament pins only a penalty ruleset its own organisation may pin.
--
-- THE DEFECT. `events.penalty_ruleset_id` and `tournaments.penalty_ruleset_id` could name any
-- penalty ruleset. Through the API, every member of a Tournament's organisation reads the ruleset
-- it pins, and a published Tournament's pin is public, so an organisation admin could pin another
-- organisation's PRIVATE ruleset on a Tournament of their own and read it there. The API now refuses
-- that at its five doors (Event default, Tournament pin, Tournament create, Tournament edit, archive
-- restore) through one function (apps/api/src/modules/penalties/penalty-version.util.ts,
-- `pinnablePenaltyRuleset`, operator rulings 64, 66, 67). But RLS `events_update` and
-- `tournaments_write` let an organisation admin write the columns straight through PostgREST, which
-- is public in production. This is the guarantee underneath (operator ruling 68).
--
-- WHAT CHANGES. A trigger on each table refuses a pin that is not the built-in, a shared ruleset
-- (`public_visibility`), or one owned by the row's own organisation (for a Tournament, its Event's).
-- It runs on insert, and on an update that changes the pin, its version, or the row's owner
-- (organisation for an Event, Event for a Tournament). An update that re-sends the same pin and
-- version is let through: Tournament edit sends the pin with every save, and a ruleset its owner
-- stopped sharing later must not block an unrelated save. Moving an Event to another organisation
-- also re-checks the pins of the Event's Tournaments, whose owner moves with it.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table and no policy change. The functions are SECURITY INVOKER and read `penalty_rulesets`,
-- `events` and `tournaments` as the writer. A writer who cannot see the ruleset (another
-- organisation's private one, under `penalty_rulesets_select`) is refused, which fails closed. The
-- API writes through the service role, which sees every row, so the rule itself decides there.

create or replace function public.penalty_pin_in_its_club()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  owner_org uuid;
begin
  if tg_table_name = 'events' then
    owner_org := new.organization_id;
  else
    select e.organization_id into owner_org from public.events e where e.id = new.event_id;
  end if;
  if not exists (
    select 1
    from public.penalty_rulesets pr
    where pr.id = new.penalty_ruleset_id
      and (pr.built_in or pr.public_visibility or pr.owner_organization_id = owner_org)
  ) then
    raise exception 'This penalty ruleset is not available to this organisation'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.penalty_pin_in_its_club() is
  'BEFORE INSERT/UPDATE trigger on events and tournaments: refuses a penalty ruleset pin that is not the built-in, shared, or owned by the row''s own organisation.';

create or replace function public.penalty_pins_follow_event_move()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if exists (
    select 1
    from public.tournaments t
    where t.event_id = new.id
      and t.penalty_ruleset_id is not null
      and not exists (
        select 1
        from public.penalty_rulesets pr
        where pr.id = t.penalty_ruleset_id
          and (pr.built_in or pr.public_visibility or pr.owner_organization_id = new.organization_id)
      )
  ) then
    raise exception 'A Tournament of this Event pins a penalty ruleset the new organisation may not use'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.penalty_pins_follow_event_move() is
  'BEFORE UPDATE OF organization_id trigger on events: refuses the move while a Tournament of the Event pins a penalty ruleset the new organisation may not pin.';

-- Idempotent: drop-then-create survives a replay without a duplicate_object throw.
drop trigger if exists events_penalty_pin_insert on public.events;
drop trigger if exists events_penalty_pin_update on public.events;
drop trigger if exists events_penalty_pins_follow_move on public.events;
drop trigger if exists tournaments_penalty_pin_insert on public.tournaments;
drop trigger if exists tournaments_penalty_pin_update on public.tournaments;

create trigger events_penalty_pin_insert
  before insert on public.events
  for each row
  when (new.penalty_ruleset_id is not null)
  execute function public.penalty_pin_in_its_club();

create trigger events_penalty_pin_update
  before update of penalty_ruleset_id, penalty_ruleset_version, organization_id on public.events
  for each row
  when (
    new.penalty_ruleset_id is not null
    and (
      new.penalty_ruleset_id is distinct from old.penalty_ruleset_id
      or new.penalty_ruleset_version is distinct from old.penalty_ruleset_version
      or new.organization_id is distinct from old.organization_id
    )
  )
  execute function public.penalty_pin_in_its_club();

create trigger events_penalty_pins_follow_move
  before update of organization_id on public.events
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function public.penalty_pins_follow_event_move();

create trigger tournaments_penalty_pin_insert
  before insert on public.tournaments
  for each row
  when (new.penalty_ruleset_id is not null)
  execute function public.penalty_pin_in_its_club();

create trigger tournaments_penalty_pin_update
  before update of penalty_ruleset_id, penalty_ruleset_version, event_id on public.tournaments
  for each row
  when (
    new.penalty_ruleset_id is not null
    and (
      new.penalty_ruleset_id is distinct from old.penalty_ruleset_id
      or new.penalty_ruleset_version is distinct from old.penalty_ruleset_version
      or new.event_id is distinct from old.event_id
    )
  )
  execute function public.penalty_pin_in_its_club();

-- Existing rows are not re-checked. Nothing is in production, and the operator wipes the stack
-- before each redeploy.
