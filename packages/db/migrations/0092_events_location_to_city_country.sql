-- Split the events.location free-text field into structured
-- city + country columns. ISO 3166-1 alpha-2 codes are stored
-- in country; the dropdown lives in the admin wizard.

ALTER TABLE events RENAME COLUMN location TO city;
ALTER TABLE events ADD COLUMN country text;
