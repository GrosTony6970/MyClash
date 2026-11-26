-- Ruling 988: the query panel's "coaches" access setting goes. MyClash has no coach role.
-- A Tournament set to it reads as the head-judges setting (an Event referee, ruling 987).

UPDATE tournament_query_settings
SET access_policy = 'organizers_head_judges'
WHERE access_policy = 'organizers_head_judges_coaches';

ALTER TABLE tournament_query_settings
  DROP CONSTRAINT IF EXISTS tournament_query_settings_access_policy_check;

ALTER TABLE tournament_query_settings
  ADD CONSTRAINT tournament_query_settings_access_policy_check
  CHECK (access_policy IN (
    'organizers_only',
    'organizers_head_judges',
    'anyone_with_tournament_access'
  ));
