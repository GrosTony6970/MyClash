-- 0227: only the API writes the record of a ruleset re-pin (the 0216 pattern).
--
-- THE DEFECT. `tournament_ruleset_repins` (0150) is the record of the audited mid-event re-pin
-- ceremony: from and to, the organiser's justification, the placings before and after, shown on
-- the Event page. The API writes it once, as the service role, and calls it the source of truth
-- (apps/api/src/modules/events/events.service.ts `writeRepinAudit`). Its policy "Super admins
-- manage tournament ruleset repins" is FOR ALL: a super admin could rewrite or delete a record
-- straight through PostgREST. None of these writes lands today: a signed-in caller's policy check
-- loops through the RLS helpers (ruling 111a leaves it latent). This closes the door so that fixing
-- the loop cannot open it: an audit record has one writer (operator ruling "Re-pin log",
-- 2026-10-18).
--
-- WHAT CHANGES. The FOR ALL policy becomes a SELECT policy of the same reach; "Org members read
-- tournament ruleset repins" stays. The two public roles lose their write grants, so a stray write
-- fails loudly (42501) instead of touching no row.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. Reads unchanged; writes from anon and authenticated refused on privilege. The
-- service role (the API) keeps every grant.

-- No IF EXISTS on the old name: a mistyped one must fail the replay (0216's rule).
drop policy "Super admins manage tournament ruleset repins" on public.tournament_ruleset_repins;

drop policy if exists "Super admins read tournament ruleset repins" on public.tournament_ruleset_repins;
create policy "Super admins read tournament ruleset repins"
  on public.tournament_ruleset_repins
  for select
  to authenticated
  using (public.is_super_admin());

revoke insert, update, delete on public.tournament_ruleset_repins from anon, authenticated;
