-- 0266: FightBook's notice switch (slice 1).
--
-- Three FightBook notices go to one fighter at once: a new spar request, a yes to a request, a
-- cancelled spar (a "Not this time" sends nothing, ruling 663). One switch turns the three off
-- ("off means off", ARCHITECTURE §11ter, ruling 200). On by default: FightBook itself is opt-in
-- (global_persons.fightbook_enabled, 0263), so switching it on is the consent. The 0165 shape.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS fightbook BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';
