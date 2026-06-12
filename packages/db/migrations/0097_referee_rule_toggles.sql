-- 0097: per-rule enable/disable toggles for the referee scheduling rules
-- surfaced in the Assignment Health panel (own pool, officiate-vs-fight,
-- double-booked, two roles, availability, capacity). All default TRUE —
-- existing behaviour unchanged until an operator unticks a rule. These are
-- independent of the legacy CHECK-constrained enforce_fighter_referee_no_overlap
-- column, which stays untouched.

ALTER TABLE pool_assignment_settings
  ADD COLUMN IF NOT EXISTS enable_own_pool_rule            BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS enable_officiate_vs_fight_rule  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS enable_double_booked_rule       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS enable_two_roles_rule           BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS enable_availability_rule        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS enable_capacity_rule            BOOLEAN NOT NULL DEFAULT TRUE;
