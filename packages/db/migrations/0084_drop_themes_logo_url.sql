-- 0084_drop_themes_logo_url.sql
--
-- Retire themes.logo_url. events.logo_url is the canonical column —
-- it's what the events list, public hero, participants page, and
-- post-creation settings card all read; tournaments use the same
-- shape (tournaments.logo_url direct, no parallel themes table per
-- 0064). Two columns / two write paths produced a real bug: the
-- new-event page wrote to themes.logo_url while every other surface
-- read events.logo_url, so freshly-uploaded logos "didn't save" as
-- far as the operator could tell.
--
-- This drops themes.logo_url. The other theme fields (colors, fonts,
-- hero image, custom CSS) stay — the themes table keeps its role
-- as the design-system store, just not for the logo.
--
-- Backfill protects existing data: any event whose logo today only
-- lives on the themes row gets that URL copied onto events.logo_url
-- before the column drops.

BEGIN;

UPDATE events e
   SET logo_url = t.logo_url,
       updated_at = NOW()
  FROM themes t
 WHERE t.event_id = e.id
   AND e.logo_url IS NULL
   AND t.logo_url IS NOT NULL;

ALTER TABLE themes DROP COLUMN IF EXISTS logo_url;

COMMIT;
