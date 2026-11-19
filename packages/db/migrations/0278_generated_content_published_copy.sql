-- 0278: a published AI text stays live while a newer one is a draft (ruling 889).
--
-- An organiser publishes a tournament recap, then presses Regenerate to improve the wording. Until
-- now the one row per (content_type, entity_id, locale) held one text: the regeneration wrote over
-- it as a draft, and the public page lost the recap until someone published again. The same held
-- for a fighter's own insight.
--
-- WHAT CHANGES.
--   1. `published_content`: the text the public reads. Publish copies `content` into it;
--      Unpublish clears it; Generate writes `content` only and leaves it alone. `content` stays
--      the latest text, which the organiser reviews.
--   2. `status` keeps its meaning for the latest text: `published` when `content` is the text the
--      public reads, `draft` when it is not (never published, or a newer text waits).
--   3. `published_at` is the time `published_content` was set, so the two are null together; a
--      CHECK holds them so. Existing published rows get their own text as the public one.
--
-- WHAT DOES NOT CHANGE. The table has no read rule (0119): every read goes through the API. No
-- function, no grant, no other table.

ALTER TABLE ai_generated_content ADD COLUMN IF NOT EXISTS published_content TEXT NULL;

UPDATE ai_generated_content
   SET published_content = content
 WHERE status = 'published' AND published_content IS NULL;

-- A row marked published with no time (none written by the API, which sets both) gets one, so the
-- CHECK below cannot refuse the migration.
UPDATE ai_generated_content
   SET published_at = updated_at
 WHERE published_content IS NOT NULL AND published_at IS NULL;

UPDATE ai_generated_content
   SET published_at = NULL
 WHERE published_content IS NULL AND published_at IS NOT NULL;

ALTER TABLE ai_generated_content
  DROP CONSTRAINT IF EXISTS ai_generated_content_published_pair;
ALTER TABLE ai_generated_content
  ADD CONSTRAINT ai_generated_content_published_pair
  CHECK ((published_content IS NULL) = (published_at IS NULL));
