-- 0158_public_events_search_indexes.sql
--
-- Indexes for the public event catalogue's new server-side filters
-- (GET /events?q=&country=&weapon=&from=&to=).
--
-- Until now the landing page fetched up to 100 events and filtered them in the
-- browser, so the only access pattern was "newest 100 published events" and the
-- existing indexes covered it. Filtering server-side turns q/country/weapon/date
-- into real predicates over the whole table.
--
-- pg_trgm is already installed (0001_init.sql).
--
-- Note on the trigram indexes: they are PLAIN GIN on the column, deliberately
-- NOT expression indexes over immutable_unaccent(...). PostgREST emits a bare
-- `name ILIKE '%x%'`, so an expression index would never be consulted — the
-- planner can only use an index whose expression matches the query's. Accent
-- insensitivity is a separate decision and would need the query side to change
-- too.

-- Public list: status filter + start_date DESC ordering, test events excluded.
CREATE INDEX IF NOT EXISTS idx_events_status_start_date
  ON events (status, start_date DESC)
  WHERE is_test_event = FALSE;

CREATE INDEX IF NOT EXISTS idx_events_country
  ON events (country)
  WHERE country IS NOT NULL;

-- Free-text: ILIKE '%term%' over the event and its organiser.
CREATE INDEX IF NOT EXISTS idx_events_name_trgm
  ON events USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_events_city_trgm
  ON events USING GIN (city gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_organizations_name_trgm
  ON organizations USING GIN (name gin_trgm_ops);

-- Weapon filtering joins events -> tournaments, because weapon lives on the
-- tournament (there is no events.weapon).
CREATE INDEX IF NOT EXISTS idx_tournaments_weapon
  ON tournaments (weapon)
  WHERE weapon IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tournaments_event_id
  ON tournaments (event_id);

NOTIFY pgrst, 'reload schema';
