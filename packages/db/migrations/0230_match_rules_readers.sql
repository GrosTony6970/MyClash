-- 0230: the scoring readers of a bout read its own copy of its rules.
--
-- THE DEFECT, continued from 0229. Bout 4 ended 5-3 at the cap of 5; the cap goes to 7; a
-- correction of bout 4 was decided at 7. From this migration's deploy the API decides a bout with
-- the copy it holds (`match_rules`): its score, its end, its clock, its rounds, the price of its
-- cards. The forfeits and how far a black card reaches still follow the Tournament (rulings A, G).
--
-- WHAT CHANGES.
--   - The backfill runs again FIRST: a bout made, or restored, between the deploy of 0229 and of
--     the API that stamps every bout holds no copy. After it no reader meets a bout with none.
--   - `card_ruleset_held_by_a_bout(ruleset)`: does a bout hold a copy that pins this card ruleset?
--     A card is priced from the live ruleset row, so a ruleset a bout holds is not edited in place
--     (the edit guard, `isPenaltyRulesetReferenced`), as one a Tournament or an Event pins is not.
--     A bout holds its copy; and, while the server has it as not started, the copies it held
--     before: a tablet may have started it on one with no network, and its Start names that copy
--     (the offline-bout slice). Once the bout starts, its earlier copies hold nothing: a
--     Tournament that moved its pin before its bouts started locks the old ruleset until they do
--     (a bout that never starts, a placeholder or a bout left unfought, keeps it locked as long as
--     its Event lives, as a fought bout's copy does). A copy no bout holds does not count.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- The function is SECURITY INVOKER (the API calls it as the service role), search_path pinned,
-- EXECUTE revoked from public, anon and authenticated by name and granted to the service role.
-- It reads `match_rules` and `matches`, both under RLS for the other roles.

select public.backfill_match_rules();

create or replace function public.card_ruleset_held_by_a_bout(p_ruleset_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.match_rules r
    join public.matches m
      on m.match_rules_id = r.id
        or (m.status = 'scheduled' and r.id = any (m.earlier_rules_ids))
    where r.penalty_ruleset_id = p_ruleset_id
  );
$$;

comment on function public.card_ruleset_held_by_a_bout(uuid) is
  'True when a bout holds a copy of its rules that pins this card ruleset (its copy, or one it held before while it is not started): the ruleset is not edited in place.';

revoke execute on function public.card_ruleset_held_by_a_bout(uuid) from public, anon, authenticated;
grant execute on function public.card_ruleset_held_by_a_bout(uuid) to service_role;
