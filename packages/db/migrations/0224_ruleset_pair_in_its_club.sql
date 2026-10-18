-- 0224: one ruleset code, one row; a Tournament written through PostgREST names only a ruleset its
-- organisation is offered.
--
-- THE DEFECT. `tournaments.ruleset_code` / `ruleset_version` could name any ruleset. The API now
-- refuses a pair its organisation is not offered at its four doors (create, edit, re-pin, preview:
-- `usableRulesetVersion` in apps/api/src/modules/events/events.service.ts) and at the archive
-- restore (`assertRestoredRulesetsUsable`). But RLS `tournaments_write` lets an organisation admin
-- write the columns straight through PostgREST, which is public in production. Pinning another
-- club's private ruleset would also freeze that club's ruleset, which counts the Tournaments that
-- pin it (operator ruling "Pair through the DB", 2026-10-18).
--
-- And two owners could hold one code: 0055's unique index includes the owner. The resolver and the
-- freeze count find a ruleset by its code alone, so a club's own row carrying another club's code
-- was a decoy that let it pin and score with that club's private ruleset, a second row with a
-- club's code stopped that club's scoring (the resolver's read of one row fails on two), and a
-- squatter could block a club from its own code. The API never means to make such a row: every
-- insert builds a code stamped to the millisecond (two inserts of one name in the same millisecond
-- clash, and the index refuses the second; the API answers 409). `custom_rulesets_org_owner_manage` lets an organisation admin write one
-- through PostgREST (operator ruling "One tag", 2026-10-18).
--
-- WHAT CHANGES.
--   1. A ruleset code is unique across every owner, a built-in's mirror included. It replaces
--      0055's per-owner index, which it implies.
--   2. A trigger refuses, for every writer but the app (see WHO IS EXEMPT), a ruleset code that
--      `ruleset_code_offered_to` does not offer the Tournament's Event's organisation:
--        * a built-in: its `is_system` mirror (0038), which has no owner (a club may write
--          `is_system` on a row of its own, never an ownerless row), passes at any version. A
--          super admin may write an ownerless `is_system` row through PostgREST and pin it: the
--          super admin is trusted at this door (operator ruling "Super admin", 2026-10-18);
--        * else a club ruleset that is shared (`public_visibility`) or the organisation's own, and
--          is neither archived nor a draft (a platform draft too: the PostgREST door stays
--          narrower than the API, operator ruling "Platform draft", 2026-10-18).
--      A writer cannot see another club's private row under RLS; the functions are SECURITY
--      DEFINER so the rule, not the writer's view, decides.
-- The version is not checked: a built-in's versions live in the code registry, and a wrong version
-- of the club's own ruleset hurts only its own Tournament; the API's doors refuse it (operator
-- ruling "Version check", 2026-10-18).
--
-- The trigger runs AFTER the row is written, on insert and on an update that changes the code, the
-- version (a version change is a new pair) or the Event: RLS refuses a writer without write
-- authority first, so only a writer who may write the row hears the trigger's answer. An update
-- that re-sends the same pair is let through: an edit sends it with every save, and a ruleset its
-- owner stopped sharing later must not block an unrelated save. So is a move of the Tournament to
-- another Event of the same organisation with the same pair. Moving an Event to another
-- organisation re-checks its Tournaments' pairs.
--
-- WHO IS EXEMPT. The service role (the API, its workers, and the restore, which may put back a
-- club's own archived or draft ruleset: rulings "Restore any version" and "Restore own draft"), and
-- a connection that set no role (`none`): any direct login, under whatever login role, such as
-- migrations, seed scripts, the probes or an operator's session; a direct login needs the database
-- password. Every role the web door switches to is checked, a role added later included (operator
-- rulings "Exempt list" and "Direct login", 2026-10-18). Inside a SECURITY DEFINER function
-- `current_user` is the owner, so the writer's role is read from the `role` setting, which
-- PostgREST sets per request and a definer call leaves alone.
--
-- OUT OF SCOPE. `matches.ruleset_code` has its own write policy and is not checked here.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table and no policy change. The three functions are SECURITY DEFINER with a pinned
-- search_path, and EXECUTE is revoked from public, anon and authenticated: a trigger function runs
-- whatever its caller's grants, and `ruleset_code_offered_to` would otherwise answer, over RPC,
-- whether a code is a live ruleset of some club. A signed-in writer refused a code by the trigger
-- learns only that it is not theirs to name. The unique index says more: an organisation admin
-- who writes a ruleset row of their own through PostgREST learns whether its code exists anywhere,
-- a private one included. Codes are stamped to the millisecond, and a pinned one is public on a
-- published Tournament anyway.

drop index if exists public.custom_rulesets_scope_unique_idx;
create unique index if not exists custom_rulesets_code_unique_idx
  on public.custom_rulesets (code);

create or replace function public.ruleset_code_offered_to(p_code text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.custom_rulesets cr
    where cr.code = p_code
      and (
        (cr.is_system and cr.owner_organization_id is null)
        or (
          not cr.is_system
          and cr.status not in ('archived', 'draft')
          and (cr.public_visibility or cr.owner_organization_id = p_org)
        )
      )
  );
$$;

comment on function public.ruleset_code_offered_to(text, uuid) is
  'True when a Tournament of organisation p_org may name ruleset p_code: a built-in''s ownerless mirror, or a live (neither archived nor draft) club ruleset that is shared or p_org''s own.';

create or replace function public.ruleset_pair_in_its_club()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_org uuid;
  old_org uuid;
begin
  if current_setting('role') in ('service_role', 'none') then
    return new;
  end if;
  select e.organization_id into owner_org from public.events e where e.id = new.event_id;
  if tg_op = 'UPDATE'
    and new.ruleset_code = old.ruleset_code
    and new.ruleset_version = old.ruleset_version
  then
    select e.organization_id into old_org from public.events e where e.id = old.event_id;
    if old_org = owner_org then
      return new;
    end if;
  end if;
  if not public.ruleset_code_offered_to(new.ruleset_code, owner_org) then
    raise exception 'This ruleset is not available to this organisation'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.ruleset_pair_in_its_club() is
  'AFTER INSERT/UPDATE trigger on tournaments: for every writer but the service role and a connection with no role, refuses a ruleset code ruleset_code_offered_to does not offer the Event''s organisation.';

create or replace function public.ruleset_pairs_follow_event_move()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if current_setting('role') in ('service_role', 'none') then
    return new;
  end if;
  if exists (
    select 1
    from public.tournaments t
    where t.event_id = new.id
      and not public.ruleset_code_offered_to(t.ruleset_code, new.organization_id)
  ) then
    raise exception 'A Tournament of this Event names a ruleset the new organisation may not use'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.ruleset_pairs_follow_event_move() is
  'AFTER UPDATE OF organization_id trigger on events: for every writer but the service role and a connection with no role, refuses the move while a Tournament of the Event names a ruleset the new organisation may not use.';

revoke execute on function public.ruleset_code_offered_to(text, uuid) from public, anon, authenticated;
revoke execute on function public.ruleset_pair_in_its_club() from public, anon, authenticated;
revoke execute on function public.ruleset_pairs_follow_event_move() from public, anon, authenticated;

-- Idempotent: drop-then-create survives a replay without a duplicate_object throw.
drop trigger if exists tournaments_ruleset_pair_insert on public.tournaments;
drop trigger if exists tournaments_ruleset_pair_update on public.tournaments;
drop trigger if exists events_ruleset_pairs_follow_move on public.events;

create trigger tournaments_ruleset_pair_insert
  after insert on public.tournaments
  for each row
  execute function public.ruleset_pair_in_its_club();

create trigger tournaments_ruleset_pair_update
  after update of ruleset_code, ruleset_version, event_id on public.tournaments
  for each row
  when (
    new.ruleset_code is distinct from old.ruleset_code
    or new.ruleset_version is distinct from old.ruleset_version
    or new.event_id is distinct from old.event_id
  )
  execute function public.ruleset_pair_in_its_club();

create trigger events_ruleset_pairs_follow_move
  after update of organization_id on public.events
  for each row
  when (new.organization_id is distinct from old.organization_id)
  execute function public.ruleset_pairs_follow_event_move();

-- Existing rows are not re-checked. Nothing is in production, and the operator wipes the stack
-- before each redeploy; a live database holding two rows of one code stops this migration at the
-- unique index.
