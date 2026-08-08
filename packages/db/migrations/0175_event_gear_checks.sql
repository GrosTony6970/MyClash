-- 0175_event_gear_checks.sql
--
-- Equipment checks, one per (event, person, weapon) — and one per RE-check.
--
-- ## Informational only. This must never become a gate.
--
-- Nothing in the scoring or scheduling path reads this table, and nothing may.
-- A failed gear check does not stop a match; it is displayed where the referee
-- already looks, and the referee decides. If a future slice wants teeth, that
-- is a separate, deliberate decision — record and show, never silently block.
--
-- ## Append-only, not one row per triple
--
-- The plan asked for both "one row per (event, person, weapon)" and "keep
-- history, so 'failed at 09:20, passed at 09:50' is readable". Those conflict,
-- and history wins: a re-check after a failure is the whole point of the
-- `conditional` and `fail` states, and overwriting would destroy the only
-- record that a fighter was ever turned away.
--
-- So there is NO unique index on the triple. Rows accumulate and the current
-- answer is the newest row for that triple, which
-- `event_gear_checks_lookup_idx` below is ordered to serve.
--
-- The cost is that a double-tap writes two rows instead of being idempotent.
-- That is acceptable here in a way it was not for arrivals (0174): two
-- identical gear passes seconds apart are indistinguishable in effect, whereas
-- a duplicated ARRIVAL would have been a second row disagreeing about who
-- marked it and when.
--
-- ## Keyed on weapon_catalog.id, never on tournaments.weapon
--
-- `tournaments.weapon` is FREE TEXT. 0017 seeds `weapon_catalog` by slugifying
-- it — lower(regexp_replace(unaccent(trim(weapon)), '[^a-zA-Z0-9]+', '-')) —
-- and 0133 warns that a blind slug update hits it. `fighter_weapons` already
-- uses a real `weapon_catalog.id` FK, and so does this table.
--
-- Keying on the free text instead would make "Longsword" and "Long sword" two
-- different weapons, and a fighter entered in both spellings would be asked to
-- gear-check twice for one kit.
--
-- ## A conditional pass without a reason is a lie
--
-- By the time it reaches the piste, a `conditional` carrying no text is
-- indistinguishable from a pass — the referee has no way to know what to watch
-- for. The CHECK below refuses it. The Zod DTO refuses it too; that is not
-- redundancy, it is the difference between "the API validates" and "the data
-- cannot be wrong". A reason on `fail` stays optional: "no gorget" is often
-- self-evident and the fighter is standing right there.

CREATE TABLE IF NOT EXISTS event_gear_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  weapon_id UUID NOT NULL REFERENCES weapon_catalog(id) ON DELETE RESTRICT,

  result TEXT NOT NULL,
  -- Mandatory on 'conditional', optional on 'fail', meaningless on 'pass'.
  reason TEXT,

  -- Who checked. NULL = recorded by an organiser through the admin app rather
  -- than by a gear staff account, which has no row in event_staff_accounts.
  checked_by_staff_account_id UUID REFERENCES event_staff_accounts(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE event_gear_checks
  DROP CONSTRAINT IF EXISTS event_gear_checks_result_allowed;
ALTER TABLE event_gear_checks
  ADD CONSTRAINT event_gear_checks_result_allowed
  CHECK (result IN ('pass', 'fail', 'conditional'));

-- The rule the whole `conditional` state exists for. Named explicitly so a
-- later migration can drop it without guessing an auto-generated name.
ALTER TABLE event_gear_checks
  DROP CONSTRAINT IF EXISTS event_gear_checks_conditional_needs_reason;
ALTER TABLE event_gear_checks
  ADD CONSTRAINT event_gear_checks_conditional_needs_reason
  CHECK (result <> 'conditional' OR (reason IS NOT NULL AND btrim(reason) <> ''));

-- "Latest check for this person and weapon" — the read behind every row of the
-- gear screen. checked_at DESC so the newest row is the first one scanned.
CREATE INDEX IF NOT EXISTS event_gear_checks_lookup_idx
  ON event_gear_checks(event_id, person_id, weapon_id, checked_at DESC);

-- FK index for the catalog side, so retiring a weapon can find its references.
CREATE INDEX IF NOT EXISTS event_gear_checks_weapon_idx
  ON event_gear_checks(weapon_id);

COMMENT ON TABLE event_gear_checks IS
  'Per-weapon equipment checks. APPEND-ONLY: the newest row per (event, person, weapon) is the current result, and older rows are the re-check history. INFORMATIONAL ONLY - never gates a match.';
COMMENT ON COLUMN event_gear_checks.reason IS
  'Required when result = conditional (enforced by event_gear_checks_conditional_needs_reason); optional on fail; unused on pass.';

ALTER TABLE event_gear_checks ENABLE ROW LEVEL SECURITY;

-- Without a policy PostgREST exposes `public` as `anon`, and these rows say
-- which named fighter turned up with unsafe equipment. Org editors only; the
-- gear desk writes through the API's service-role connection with an mc_staff
-- session, gated on the account's `gear` role.
CREATE POLICY "Org editors manage event gear checks"
  ON event_gear_checks
  FOR ALL
  USING (
    has_org_role(
      (SELECT organization_id FROM events WHERE events.id = event_gear_checks.event_id),
      'editor'
    )
  )
  WITH CHECK (
    has_org_role(
      (SELECT organization_id FROM events WHERE events.id = event_gear_checks.event_id),
      'editor'
    )
  );

NOTIFY pgrst, 'reload schema';
