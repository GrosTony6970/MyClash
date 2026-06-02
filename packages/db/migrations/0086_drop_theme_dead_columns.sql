-- Migration 0086: drop dead theme columns.
--
-- The per-event color pickers + font dropdowns + custom_css textarea
-- were write-only knobs: the public app's CSS vars (--color-primary,
-- --color-secondary, --color-accent, --font-display, --font-body)
-- weren't actually read by any component (every public surface
-- hardcoded Tailwind classes), and custom_css was never used by an
-- organiser yet introduced a sanitisation-vs-injection footgun.
--
-- The unified MyClash design (Slice 1 of the public redesign) governs
-- both apps from one set of design tokens. Per-event identity is now
-- carried by:
--   - events.logo_url       — the event card + event header logo
--   - themes.hero_image_url — the per-event hero on /e/<slug>/home
--   - organizations.brand_color (migration 0085) — landing event-card
--     left-edge accent stripe
--   - tournaments.color     — per-tournament accent stripe inside
--     the event subtree
--
-- After this migration the `themes` table holds only id + event_id
-- + hero_image_url (+ created/updated_at timestamps if any). A
-- future migration could collapse hero_image_url onto events but the
-- schema churn isn't worth it until something else needs to touch
-- this table.

ALTER TABLE themes
  DROP COLUMN IF EXISTS primary_color,
  DROP COLUMN IF EXISTS secondary_color,
  DROP COLUMN IF EXISTS accent_color,
  DROP COLUMN IF EXISTS font_display,
  DROP COLUMN IF EXISTS font_body,
  DROP COLUMN IF EXISTS custom_css;

NOTIFY pgrst, 'reload schema';
