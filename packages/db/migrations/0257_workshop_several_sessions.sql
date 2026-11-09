-- 0257: a Workshop may run several sessions (operator ruling 515).
--
-- "Longsword basics" can run Saturday 10:00 and Sunday 14:00, each session with its own seats,
-- waitlist and roster. 0098 made workshop_id UNIQUE so the session create could upsert on it;
-- the create now inserts, and a move names its session by id.
--
-- That constraint was also the only index on the foreign key: the Workshop's sessions are read by
-- workshop_id, and a Workshop's delete cascades by it. The new index keeps both, in start order.
--
-- No new table and no new column: the RLS policies of 0002 stand.

ALTER TABLE public.workshop_sessions
  DROP CONSTRAINT IF EXISTS workshop_sessions_workshop_id_key;

CREATE INDEX IF NOT EXISTS workshop_sessions_workshop_idx
  ON public.workshop_sessions (workshop_id, starts_at);

NOTIFY pgrst, 'reload schema';
