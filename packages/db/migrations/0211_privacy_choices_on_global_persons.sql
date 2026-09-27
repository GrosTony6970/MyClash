-- 0211: a person's privacy choices live on their global person (rulings 132, 155, 156).
--
-- `person_privacy` (0001) was keyed by `persons.id`, which is EVENT-SCOPED: a competitor in five
-- Events held five answers to one question, and a choice made before an Event existed never
-- reached it. Léa unticks "Allow others to follow me", registers for next month's Event, and was
-- followable there. 0187 moved the directory flag to `global_persons` for the same reason; the two
-- choices follow it.
--
-- 1. `global_persons` gains `hide_workshops_publicly` (default false) and `allow_being_followed`
--    (default true): 0001's defaults.
-- 2. Every person's rows fold to the STRICTER answer per choice, as the settings page already read
--    them (hide if any row hides; followable only if every row allows). A row whose person has no
--    global person has nowhere to go and is dropped with the table.
-- 3. `person_privacy` goes, and with it `show_real_email_to_followers`: no screen, no reader and no
--    writer since 0001 (ruling 156).
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. `global_persons_select` (0187) lets anyone read the row of a fighter listed in the
-- directory, so a listed fighter's two answers become readable straight from the database. Accepted
-- (ruling 155): "accepts followers" is already on their public person page. The API's public
-- fighter projection copies an allow-list of columns, so neither choice reaches it.
--
-- ── Archives ────────────────────────────────────────────────────────────────
--
-- An archive exported before this migration carries `personPrivacy`; the restore reads only the
-- tables it knows, so that key is ignored. The choices are the person's own, not the club's: they
-- stay on the global person.
--
-- No IF EXISTS anywhere: a mistyped name must fail the replay, not pass it.

ALTER TABLE global_persons
  ADD COLUMN hide_workshops_publicly BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN allow_being_followed BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE global_persons gp
SET hide_workshops_publicly = f.hide,
    allow_being_followed = f.allow
FROM (
  SELECT p.global_person_id,
         bool_or(pp.hide_workshops_publicly) AS hide,
         bool_and(pp.allow_being_followed) AS allow
  FROM person_privacy pp
  JOIN persons p ON p.id = pp.person_id
  WHERE p.global_person_id IS NOT NULL
  GROUP BY p.global_person_id
) f
WHERE gp.id = f.global_person_id;

DROP TABLE person_privacy;

NOTIFY pgrst, 'reload schema';
