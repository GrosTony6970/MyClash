-- 0071_penalty_ref_alphanumeric.sql
--
-- Allow alphanumeric penalty REF identifiers like "R7a" or "B-12" by
-- widening the column type from INTEGER to TEXT. Real rulebooks use
-- mixed-case codes for sub-rules and the engine has always treated
-- refNumber as an opaque identifier, never as an arithmetic counter —
-- the integer constraint was the only thing keeping it numeric.
--
-- Existing rows cast cleanly via `USING ref_number::text`, so historical
-- integer values like 1, 2, 3 stay readable as "1", "2", "3" and remain
-- comparable in the unique constraint.
--
-- Two tables touch this column: the per-ruleset entries (template) and
-- the per-match snapshot rows that record actual sanctions handed out.

BEGIN;

-- Per-ruleset template entries.
ALTER TABLE penalty_ruleset_entries
  ALTER COLUMN ref_number TYPE TEXT USING ref_number::text;

-- The CHECK (ref_number > 0) constraint becomes meaningless once REF is
-- text. Drop it; the engine + API layer enforce non-empty + safe-char
-- + length-bound validation now.
ALTER TABLE penalty_ruleset_entries
  DROP CONSTRAINT IF EXISTS penalty_entries_ref_check;

-- Per-match snapshot rows on match_penalties carry the same REF identifier
-- when a penalty was issued via a ruleset entry (nullable for direct
-- card overrides).
ALTER TABLE match_penalties
  ALTER COLUMN ref_number TYPE TEXT USING ref_number::text;

-- The existing UNIQUE(ruleset_id, ref_number) and btree indices survive
-- the column type change automatically — Postgres rebuilds them.

COMMIT;
