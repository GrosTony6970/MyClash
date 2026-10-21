-- 0238: only the API writes a Match and what is recorded on it, and only the API deletes a phase
-- or a Registration (the 0233 pattern; operator rulings 96, 97, 99 and 100, 2026-10-21).
--
-- THE DEFECT. Five tables hold what a Match is and what happened in it: `matches`, `exchanges`,
-- `match_events`, `match_penalties` and `match_forfeits`. 0002 and 0016 gave four of them a write
-- policy for a signed-in user: `matches_write` (FOR ALL: a super admin, the Match's own
-- `scorekeeper_user_id`, an organisation member with the role scorekeeper or higher),
-- `exchanges_insert`, `exchanges_update`, `match_events_write` and `match_penalties_all` (FOR ALL).
-- With them a scorekeeper could rewrite a Match score, delete a played Match, void an Exchange or
-- remove a card straight through PostgREST, past every door of the API (the lock, the frozen
-- results, the ruleset engine, the audit line). One level up, `phases_write` (0002, FOR ALL for an
-- organisation admin) lets an admin delete a phase, and the delete takes every Match in it by
-- cascade, with its Exchanges, events, penalties and forfeits, past the API's rule that the club
-- owner agrees before fought Matches are discarded. And `registrations_write` (0002, FOR ALL for an
-- organisation editor) lets an editor delete a Registration, and the delete takes the cards recorded
-- on it (`match_penalties.registration_id` is ON DELETE CASCADE). 0237 refuses, at commit, the
-- delete of a Registration a Match side or a forfeit names, but nothing ties a card's Registration
-- to its Match's sides: a direct card on a Match not yet started stays when a re-seed or a corrected
-- feeder clears that Match's pairing. None of these writes lands today: a signed-in policy check
-- loops through the RLS helpers (ruling 111a leaves it latent). With the helpers made SECURITY
-- DEFINER (the loop fixed), an organisation admin's UPDATE of a Match score and DELETE of a Match
-- both land. This closes the doors so that fixing the loop cannot open them.
--
-- WHAT CHANGES.
--   1. The five write policies go, and so does `match_forfeits_service_all` (0032): it let only
--      `auth.role() = 'service_role'` through, and the service role bypasses RLS, so it could never
--      decide anything.
--   2. The two public roles lose INSERT, UPDATE and DELETE on the five tables, so a stray write
--      fails loudly (42501) instead of touching no row.
--   3. The two public roles lose DELETE on `phases` (ruling 99) and on `registrations` (ruling
--      100). `phases_write` and `registrations_write` stay: both are still insertable and
--      updatable through PostgREST (below).
--   Both roles keep TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from the image's default privileges,
--   as on the tables of 0216, 0227 and 0233: PostgREST has no verb for them and both roles are
--   NOLOGIN.
--
-- WHAT DOES NOT CHANGE. Anonymous reads: `matches_select`, `match_events_select`,
-- `exchanges_select`, `match_penalties_select` (0200) and `phases_select` stay, so the public pages
-- and the Realtime feeds (Realtime connects as `POSTGRES_USER`, a superuser) read what they read
-- before. `match_forfeits` has no read policy and stays closed to both roles. One signed-in read
-- narrows: a FOR ALL policy also grants SELECT, so `matches_write` and `match_events_write` let the
-- Match's own `scorekeeper_user_id` read it, and the read policies have no such branch. No client
-- uses it: the browsers read as anon, and a signed-in read loops today. No app writes these tables
-- or deletes a phase or a Registration through PostgREST: the API writes as the service role, the
-- pad calls the API. Three functions update `matches` (`stamp_match_rules`,
-- `programme_place_bouts`, `programme_retime_bouts`): all SECURITY INVOKER and executable by the
-- service role only, so they keep working, and a web caller would now also fail on privilege. The
-- three triggers on `matches` refuse or stamp for every writer and stay. No row is written and no
-- table is altered here.
--
-- STILL WRITABLE DIRECTLY, named (ruling 97: only the Match tables and the two deletes now;
-- ruling 98: a sweep of every remaining web write door is queued). The card reviews
-- (`tournament_penalty_reviews_all`), the Exchange edit requests (two policies), `bracket_slots`,
-- `pools`, `pool_members`, `swiss_rounds`, `swiss_entrants`, the INSERT and UPDATE of a phase and
-- of a Registration, and 0233's list less `matches.status`: `events.status` and
-- `events.penalty_ruleset_id`. Through these doors a write still reaches a Match as the tables'
-- owner: a Pool, bracket slot, Swiss round, piste or staff account delete sets the Match's or its
-- records' key to NULL (ON DELETE SET NULL), detaching a played Match from its Pool or an Exchange
-- from its scorer; a phase UPDATE of `tournament_id` moves its Matches to another Tournament, with
-- the copy of the old one's rules. No CASCADE delete into the five tables stays open: the only
-- chains start at `registrations` and `phases` (closed here), `tournaments` (0233), `events` and
-- `organizations` (0237) and `matches`; a Person delete is refused at commit by its Registrations
-- (0237).
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no new function. Reads from anon unchanged; writes from anon and authenticated
-- refused on privilege. The service role (the API) keeps every grant.

-- No IF EXISTS on the old names: a mistyped one must fail the replay (0216's rule).
drop policy "matches_write" on public.matches;
drop policy "exchanges_insert" on public.exchanges;
drop policy "exchanges_update" on public.exchanges;
drop policy "match_events_write" on public.match_events;
drop policy "match_penalties_all" on public.match_penalties;
drop policy match_forfeits_service_all on public.match_forfeits;

revoke insert, update, delete
  on public.matches, public.exchanges, public.match_events, public.match_penalties,
     public.match_forfeits
  from anon, authenticated;

revoke delete on public.phases, public.registrations from anon, authenticated;
