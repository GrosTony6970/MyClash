-- 0185_league_global_person_id.sql
--
-- Renames league_rankings.fighter_id and league_tournament_results.fighter_id
-- to global_person_id.
--
-- WHY: both columns are foreign keys to global_persons(id). Migration 0023
-- renamed the `fighters` table to `global_persons` and cascaded the FK target,
-- but left these two column names behind — so the name denoted the competing
-- role while the value is a cross-event identity. docs/decisions/ADR-013
-- rules Fighter a role, never an entity, and calls these the archetype of the
-- wrong-concept class.
--
-- These column names are also the JSON keys inside event archives and GDPR
-- subject exports. That would normally make them an external contract, but no
-- export has been taken from production yet and the stack is redeployed from
-- scratch, so this lands as a clean rename with no compatibility path.
--
-- ALTER TABLE ... RENAME COLUMN does NOT rename constraints derived from the
-- column, so the FK and UNIQUE constraints are renamed explicitly. Their
-- current names are auto-generated and one of them IS truncated at Postgres's
-- 63-character identifier limit — league_tournament_results' UNIQUE lands as
-- ..._fighter_i_key, missing the 'd'. They are therefore discovered from the
-- catalog and matched on 'fighter' rather than assumed or matched on
-- 'fighter_id'. A replay on a real Postgres is the only way to see this.

ALTER TABLE league_rankings RENAME COLUMN fighter_id TO global_person_id;
ALTER TABLE league_tournament_results RENAME COLUMN fighter_id TO global_person_id;

DO $$
DECLARE
  con RECORD;
  new_name TEXT;
BEGIN
  FOR con IN
    SELECT c.conname, c.contype, t.relname AS table_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('league_rankings', 'league_tournament_results')
      -- Match on 'fighter', NOT 'fighter_id': Postgres truncates generated
      -- constraint names at 63 characters, and
      -- league_tournament_results_league_id_tournament_id_fighter_id_key is
      -- over that — it lands as ..._fighter_i_key, which '%fighter_id%' misses.
      AND c.conname LIKE '%fighter%'
  LOOP
    -- Auto-generated UNIQUE names embed every column and would exceed the
    -- 63-character identifier limit if rebuilt verbatim, so they get a
    -- deliberately short name instead of a mechanical substitution.
    IF con.contype = 'u' THEN
      new_name := CASE con.table_name
        WHEN 'league_rankings' THEN 'league_rankings_league_group_person_key'
        ELSE 'league_tournament_results_league_tournament_person_key'
      END;
    ELSE
      new_name := replace(con.conname, 'fighter_id', 'global_person_id');
    END IF;

    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', con.table_name, con.conname, new_name);
    RAISE NOTICE 'renamed constraint % -> % on %', con.conname, new_name, con.table_name;
  END LOOP;
END $$;

-- Guard: fail loudly if either column survived under the old name, rather than
-- leaving a half-applied rename for the application to trip over.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('league_rankings', 'league_tournament_results')
      AND column_name = 'fighter_id'
  ) THEN
    RAISE EXCEPTION '0185 did not rename every fighter_id column';
  END IF;
END $$;
