-- 0094_matches_bracket_slot_id_active_uniq.sql
--
-- Guard against duplicate live match rows for the same bracket slot.
--
-- The bracket pipeline now pre-creates one matches row per non-bye
-- bracket_slots row at generation time (phases.service.ts
-- createInitialBracketMatches), then UPDATEs registrations into the
-- existing row as upstream matches resolve (bracket-advance.service.ts
-- writeSlotSide / advanceFromSlot). The legacy createMatchIfReady
-- INSERT path stays as a defensive fallback. A partial unique index
-- ensures any code path that accidentally tries to INSERT a second
-- live row for an already-occupied slot hard-errors instead of
-- silently corrupting the bracket.
--
-- Voided rows (cascading-forfeit / regen flow) intentionally sit
-- outside the constraint so a replayed slot can still get a fresh
-- live row alongside the voided history. Voidedness is encoded as
-- `status = 'voided'`, not a dedicated boolean column.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS matches_bracket_slot_id_active_uniq
  ON matches (bracket_slot_id)
  WHERE bracket_slot_id IS NOT NULL AND status <> 'voided';

NOTIFY pgrst, 'reload schema';

COMMIT;
