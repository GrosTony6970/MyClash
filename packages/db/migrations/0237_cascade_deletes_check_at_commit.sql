-- 0237: a cascade delete no longer depends on the order its triggers fire (operator rulings 91, 92,
-- 93 and 95, 2026-10-21).
--
-- THE DEFECT. A super-admin approves a club's request to delete an Event that held bouts. The API
-- sends one `DELETE FROM events`, and Postgres deletes everything below it by cascade. It fails as
-- soon as one Fighter is registered: the cascade reaches the Event's persons before their
-- registrations, and `registrations.person_id` (RESTRICT) refuses. A Tournament delete fails the same
-- way on `matches.red_registration_id` once a bout names a Fighter, and on some databases on
-- `matches.match_rules_id`. Why: Postgres fires a table's foreign key triggers in NAME order, the
-- name holds the trigger's OID as text (`RI_ConstraintTrigger_a_100646` sorts before `…_a_97401`),
-- and an immediate key is checked as soon as the cascade step that deleted its parent ends. When the
-- parent's branch runs first, the child row is still there. The verdict then depends on where the
-- OID counter stood when each key was made. The API's own Event and Tournament deletes worked only
-- because they deleted the bouts and registrations by hand first; the deletion-request approval and
-- the club delete did not, and failed.
--
-- WHAT CHANGES.
--   1. The nine keys whose child and parent both die by cascade from one ancestor (an Event, a
--      Tournament, a club) become NO ACTION DEFERRABLE INITIALLY DEFERRED: checked once, at the end
--      of the transaction, when the whole cascade is done. Every refusal they gave still holds: a
--      person with a registration, a registration a bout or a forfeit names, a copy a bout holds, a
--      referee skill a slot lists, a compensation plan an Event uses are still not deleted. The
--      refusal arrives at COMMIT instead of mid-statement; PostgREST (one request, one transaction)
--      answers it as before: 409, code 23503. Not CASCADE: deleting a registration must not delete
--      its bouts. Not RESTRICT DEFERRABLE: Postgres checks a RESTRICT key at once even when it is
--      deferrable, so the order would still matter.
--   2. Ruling 93: only the API deletes an Event. `events_delete` (0002) let a club owner delete an
--      Event straight through PostgREST, past the API's checks (recorded results; an archived Event
--      needs a deletion request). Only the RLS helper loop (ruling 111a) stopped it; with the keys
--      above no longer refusing, fixing the loop would open it. The policy goes and the two public
--      roles lose DELETE on `events` (the 0233 pattern): a stray delete fails loudly (42501).
--      Reads, inserts and updates of `events` do not change (0233's "still writable directly" list
--      stays named).
--   3. Ruling 95: only the API deletes a club, for the same reason. `orgs_delete` (0002) let a
--      signed-in super admin delete a club through PostgREST, past the API's HQ guard and its
--      `org.delete` audit line; with the keys above it would now cascade. The policy goes and the
--      two public roles lose DELETE on `organizations`.
--
-- THE RULE FOR LATER MIGRATIONS. A transaction that writes one of the nine keys (an insert or a
-- key change on the child, a delete on the parent) queues a check until COMMIT, and Postgres then
-- refuses an ALTER of that table: "cannot ALTER TABLE … because it has pending trigger events"
-- (55006). A migration runs in one transaction: one that writes those rows and then ALTERs one of
-- those tables runs `SET CONSTRAINTS ALL IMMEDIATE` before the ALTER.
--
-- Rows inserted in the SAME transaction as their delete are re-checked on every update Postgres
-- makes to them, so a cascade that sets one of their columns to NULL can still fail by order. No
-- API path deletes what it inserted in the same transaction; `db:cascade-probe` tests on committed
-- rows for that reason.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no new function. A foreign key check runs as the table's owner whatever its timing,
-- so who may read or write a row does not change. Event and club deletes from anon and
-- authenticated are refused on privilege; the service role (the API) keeps every grant.

-- No IF EXISTS on the old names: a name that differs must fail the migration (0216's rule).
alter table public.registrations
  drop constraint registrations_person_id_fkey,
  add constraint registrations_person_id_fkey
    foreign key (person_id) references public.persons (id) deferrable initially deferred;

alter table public.matches
  drop constraint matches_red_registration_id_fkey,
  drop constraint matches_blue_registration_id_fkey,
  drop constraint matches_match_rules_id_fkey,
  add constraint matches_red_registration_id_fkey
    foreign key (red_registration_id) references public.registrations (id)
    deferrable initially deferred,
  add constraint matches_blue_registration_id_fkey
    foreign key (blue_registration_id) references public.registrations (id)
    deferrable initially deferred,
  add constraint matches_match_rules_id_fkey
    foreign key (match_rules_id) references public.match_rules (id) deferrable initially deferred;

alter table public.match_forfeits
  drop constraint match_forfeits_forfeiting_registration_id_fkey,
  drop constraint match_forfeits_winner_registration_id_fkey,
  add constraint match_forfeits_forfeiting_registration_id_fkey
    foreign key (forfeiting_registration_id) references public.registrations (id)
    deferrable initially deferred,
  add constraint match_forfeits_winner_registration_id_fkey
    foreign key (winner_registration_id) references public.registrations (id)
    deferrable initially deferred;

alter table public.tournament_slot_allowed_skills
  drop constraint tournament_slot_allowed_skills_skill_id_fkey,
  add constraint tournament_slot_allowed_skills_skill_id_fkey
    foreign key (skill_id) references public.referee_skills (id) deferrable initially deferred;

alter table public.event_slot_config_default_skills
  drop constraint event_slot_config_default_skills_skill_id_fkey,
  add constraint event_slot_config_default_skills_skill_id_fkey
    foreign key (skill_id) references public.referee_skills (id) deferrable initially deferred;

alter table public.referee_compensation_event_settings
  drop constraint referee_compensation_event_settings_plan_id_fkey,
  add constraint referee_compensation_event_settings_plan_id_fkey
    foreign key (plan_id) references public.referee_compensation_plans (id)
    deferrable initially deferred;

drop policy "events_delete" on public.events;

revoke delete on public.events from anon, authenticated;

drop policy "orgs_delete" on public.organizations;

revoke delete on public.organizations from anon, authenticated;

-- Prove it landed: each key reads back exactly as written; no key that a cascade can trip by order
-- is left (any RESTRICT key, deferrable or not, and any immediate NO ACTION key, whose child and
-- parent both die by cascade from one ancestor); no web role may delete an Event or a club.
do $$
declare
  expected constant jsonb := jsonb_build_object(
    'registrations_person_id_fkey',
      'FOREIGN KEY (person_id) REFERENCES persons(id) DEFERRABLE INITIALLY DEFERRED',
    'matches_red_registration_id_fkey',
      'FOREIGN KEY (red_registration_id) REFERENCES registrations(id) DEFERRABLE INITIALLY DEFERRED',
    'matches_blue_registration_id_fkey',
      'FOREIGN KEY (blue_registration_id) REFERENCES registrations(id) DEFERRABLE INITIALLY DEFERRED',
    'matches_match_rules_id_fkey',
      'FOREIGN KEY (match_rules_id) REFERENCES match_rules(id) DEFERRABLE INITIALLY DEFERRED',
    'match_forfeits_forfeiting_registration_id_fkey',
      'FOREIGN KEY (forfeiting_registration_id) REFERENCES registrations(id) DEFERRABLE INITIALLY DEFERRED',
    'match_forfeits_winner_registration_id_fkey',
      'FOREIGN KEY (winner_registration_id) REFERENCES registrations(id) DEFERRABLE INITIALLY DEFERRED',
    'tournament_slot_allowed_skills_skill_id_fkey',
      'FOREIGN KEY (skill_id) REFERENCES referee_skills(id) DEFERRABLE INITIALLY DEFERRED',
    'event_slot_config_default_skills_skill_id_fkey',
      'FOREIGN KEY (skill_id) REFERENCES referee_skills(id) DEFERRABLE INITIALLY DEFERRED',
    'referee_compensation_event_settings_plan_id_fkey',
      'FOREIGN KEY (plan_id) REFERENCES referee_compensation_plans(id) DEFERRABLE INITIALLY DEFERRED'
  );
  wrong text;
  tripped text;
begin
  select string_agg(e.key || ' reads ' || coalesce(
           replace(pg_get_constraintdef(c.oid), 'public.', ''), 'nothing'), '; ')
    into wrong
    from jsonb_each_text(expected) e
    left join pg_constraint c
      on c.conname = e.key and c.contype = 'f' and c.connamespace = 'public'::regnamespace
   where replace(pg_get_constraintdef(c.oid), 'public.', '') is distinct from e.value;
  if wrong is not null then
    raise exception '0237: a key does not read as written: %', wrong;
  end if;

  with recursive fk as (
    select c.conname, c.conrelid as child, c.confrelid as parent, c.confdeltype, c.condeferred
      from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
  ),
  reach (anc, tbl) as (
    select distinct parent, parent from fk
    union
    select r.anc, f.child from reach r join fk f on f.parent = r.tbl and f.confdeltype = 'c'
  )
  select string_agg(distinct f.conname, ', ')
    into tripped
    from fk f
    join reach rp on rp.tbl = f.parent and rp.anc <> f.parent
    join reach rc on rc.tbl = f.child and rc.anc = rp.anc
   where f.confdeltype = 'r' or (f.confdeltype = 'a' and not f.condeferred);
  if tripped is not null then
    raise exception '0237: a cascade can still trip these keys by trigger order: %', tripped;
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename in ('events', 'organizations')
       and cmd in ('DELETE', 'ALL')
  ) then
    raise exception '0237: a policy still lets a web role delete an Event or a club';
  end if;
  if has_table_privilege('anon', 'public.events', 'DELETE')
    or has_table_privilege('authenticated', 'public.events', 'DELETE')
    or has_table_privilege('anon', 'public.organizations', 'DELETE')
    or has_table_privilege('authenticated', 'public.organizations', 'DELETE')
  then
    raise exception '0237: a web role still holds DELETE on events or organizations';
  end if;
end $$;

notify pgrst, 'reload schema';
