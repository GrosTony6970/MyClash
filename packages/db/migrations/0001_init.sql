-- ============================================================
-- MyClash — Initial schema migration
-- Generated for: T-101 · DB schema (Drizzle)
-- Apply with: pnpm --filter @myclash/db migrate
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ── Platform roles ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_roles (
  user_id    UUID PRIMARY KEY NOT NULL,
  role       TEXT NOT NULL DEFAULT 'super_admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Push subscriptions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  endpoint     TEXT NOT NULL,
  p256dh_key   TEXT NOT NULL,
  auth_key     TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

-- ── Notification preferences ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id                          UUID PRIMARY KEY NOT NULL,
  match_starting_minutes_before    TEXT DEFAULT '10',
  workshop_starting_minutes_before TEXT DEFAULT '15',
  referee_starting_minutes_before  TEXT DEFAULT '10',
  schedule_changes                 BOOLEAN NOT NULL DEFAULT TRUE,
  results_published                BOOLEAN NOT NULL DEFAULT TRUE,
  enabled                          BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── Organizations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  contact_email      TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organizations_status_check CHECK (status IN ('active', 'suspended'))
);

-- ── Organization members ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  role            TEXT NOT NULL DEFAULT 'admin',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- ── Clubs ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clubs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  city         TEXT,
  country_code TEXT,
  website      TEXT,
  logo_url     TEXT,
  unverified   TEXT DEFAULT 'false',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- pg_trgm index for fuzzy club name matching (used in CSV import)
CREATE INDEX IF NOT EXISTS clubs_name_trgm_idx
  ON clubs USING GIN (unaccent(name) gin_trgm_ops);

-- ── Fighters ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fighters (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT NOT NULL UNIQUE,
  display_name       TEXT NOT NULL,
  given_name         TEXT NOT NULL,
  family_name        TEXT NOT NULL,
  club_id            UUID REFERENCES clubs(id) ON DELETE SET NULL,
  country_code       TEXT,
  hema_ratings_id    TEXT,
  photo_url          TEXT,
  bio                TEXT,
  date_of_birth      TEXT,
  gender_category    TEXT,
  claimed_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Audit log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  payload_json  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (actor_user_id);

-- ── Events ────────────────────────────────────────────────────────────────────
-- Platform moderation tables -----------------------------------------------
CREATE TABLE IF NOT EXISTS ruleset_submissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT NOT NULL,
  version              TEXT NOT NULL,
  display_name         TEXT NOT NULL,
  description          TEXT,
  submitted_by_user_id UUID,
  package_ref          TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_user_id  UUID,
  reviewed_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ruleset_submissions_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT ruleset_submissions_code_version_unique UNIQUE (code, version)
);

CREATE INDEX IF NOT EXISTS ruleset_submissions_status_idx
  ON ruleset_submissions (status);

CREATE TABLE IF NOT EXISTS feature_flags (
  key                TEXT PRIMARY KEY,
  description        TEXT,
  enabled            BOOLEAN NOT NULL DEFAULT false,
  payload_json       JSONB,
  updated_by_user_id UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feature_flags_enabled_idx
  ON feature_flags (enabled);

CREATE TABLE IF NOT EXISTS events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  name              TEXT NOT NULL,
  location          TEXT,
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft',
  theme_id          UUID,
  public_landing_md TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, slug),
  CONSTRAINT events_status_check CHECK (status IN ('draft','published','running','completed','archived'))
);

-- ── Themes ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS themes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  primary_color   TEXT DEFAULT '#c0392b',
  secondary_color TEXT DEFAULT '#2c3e50',
  accent_color    TEXT DEFAULT '#f39c12',
  logo_url        TEXT,
  hero_image_url  TEXT,
  font_display    TEXT DEFAULT 'Cinzel',
  font_body       TEXT DEFAULT 'Inter',
  custom_css      TEXT
);

-- ── Lices ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  location_label TEXT,
  color_hex      TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

-- ── Persons ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS persons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  given_name          TEXT NOT NULL,
  family_name         TEXT NOT NULL,
  email               TEXT NOT NULL,
  club_id             UUID REFERENCES clubs(id) ON DELETE SET NULL,
  hema_ratings_id     TEXT,
  date_of_birth       TEXT,
  gender_category     TEXT,
  notes               TEXT,
  claim_status        TEXT NOT NULL DEFAULT 'unclaimed',
  claimed_by_user_id  UUID,
  global_fighter_id   UUID REFERENCES fighters(id) ON DELETE SET NULL,
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT persons_claim_status_check CHECK (claim_status IN ('unclaimed','guest_active','claimed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS persons_event_id_lower_email_unique
  ON persons (event_id, lower(email));

-- pg_trgm indexes for fuzzy name lookup (T-104b)
CREATE INDEX IF NOT EXISTS persons_given_name_trgm_idx
  ON persons USING GIN (unaccent(given_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS persons_family_name_trgm_idx
  ON persons USING GIN (unaccent(family_name) gin_trgm_ops);

-- ── Guest sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guest_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  device_label  TEXT,
  ip_first_seen TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);

-- ── Follows ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follows (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  followed_person_id       UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  follower_user_id         UUID,
  follower_guest_session_id UUID REFERENCES guest_sessions(id) ON DELETE CASCADE,
  notify_match_start       BOOLEAN NOT NULL DEFAULT TRUE,
  notify_workshop_start    BOOLEAN NOT NULL DEFAULT FALSE,
  notify_referee_start     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactly one follower type must be set
  CONSTRAINT follows_one_follower_check CHECK (
    (follower_user_id IS NOT NULL AND follower_guest_session_id IS NULL)
    OR
    (follower_user_id IS NULL AND follower_guest_session_id IS NOT NULL)
  ),
  -- Prevent duplicate follows (NULLS NOT DISTINCT requires Postgres 15+)
  UNIQUE NULLS NOT DISTINCT (event_id, followed_person_id, follower_user_id, follower_guest_session_id)
);

-- ── Person privacy ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS person_privacy (
  person_id                   UUID PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
  hide_workshops_publicly     BOOLEAN NOT NULL DEFAULT FALSE,
  allow_being_followed        BOOLEAN NOT NULL DEFAULT TRUE,
  show_real_email_to_followers BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Referee qualifications ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referee_qualifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  rating     INTEGER CHECK (rating BETWEEN 1 AND 5),
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, event_id, role),
  CONSTRAINT referee_role_check CHECK (role IN ('arbitre_declarant','arbitre_assesseur','arbitre_table'))
);

-- ── Tournaments ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  weapon          TEXT,
  category        TEXT,
  ruleset_code    TEXT NOT NULL DEFAULT 'TF_v1',
  ruleset_version TEXT NOT NULL DEFAULT '1',
  ruleset_config  JSONB,
  status          TEXT NOT NULL DEFAULT 'draft',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, slug)
);

-- ── Registrations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS registrations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  person_id     UUID NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
  fighter_id    UUID REFERENCES fighters(id) ON DELETE SET NULL,
  seed          INTEGER,
  status        TEXT NOT NULL DEFAULT 'registered',
  bib_number    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, person_id),
  CONSTRAINT registration_status_check CHECK (status IN ('registered','checked_in','withdrawn','disqualified'))
);

-- ── Phases ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  config_json   JSONB,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phase_type_check CHECK (type IN ('pool','single_elim','double_elim','swiss'))
);

-- ── Pools ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pools (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id   UUID NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ── Pool members ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pool_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id         UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  seed            INTEGER,
  UNIQUE(pool_id, registration_id)
);

-- ── Bracket slots ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bracket_slots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id          UUID NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  round             INTEGER NOT NULL,
  position          INTEGER NOT NULL,
  source_a_type     TEXT,
  source_a_ref      TEXT,
  source_b_type     TEXT,
  source_b_ref      TEXT,
  registration_a_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  registration_b_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  UNIQUE(phase_id, round, position)
);

-- ── Pool assignment settings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pool_assignment_settings (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tournament_id                    UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  enforce_school_separation        BOOLEAN NOT NULL DEFAULT TRUE,
  school_separation_strictness     TEXT NOT NULL DEFAULT 'soft',
  enforce_skill_balance            BOOLEAN NOT NULL DEFAULT TRUE,
  skill_rating_source              TEXT NOT NULL DEFAULT 'hema_ratings',
  enforce_referee_no_back_to_back  BOOLEAN NOT NULL DEFAULT TRUE,
  referee_rest_min_slots           INTEGER NOT NULL DEFAULT 1,
  enforce_dedicated_referee_rest   BOOLEAN NOT NULL DEFAULT TRUE,
  -- Hard constraint: MUST always be TRUE (AGENTS.md rule #8)
  enforce_fighter_referee_no_overlap BOOLEAN NOT NULL DEFAULT TRUE
    CONSTRAINT enforce_fighter_referee_no_overlap_must_be_true CHECK (enforce_fighter_referee_no_overlap = TRUE),
  prefer_high_rated_referees       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Matches ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id              UUID NOT NULL,
  pool_id               UUID REFERENCES pools(id) ON DELETE SET NULL,
  bracket_slot_id       UUID,
  lice_id               UUID REFERENCES lices(id) ON DELETE SET NULL,
  red_registration_id   UUID REFERENCES registrations(id) ON DELETE RESTRICT,
  blue_registration_id  UUID REFERENCES registrations(id) ON DELETE RESTRICT,
  scheduled_at          TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  duration_active_ms    INTEGER,
  duration_total_ms     INTEGER,
  red_score             INTEGER NOT NULL DEFAULT 0,
  blue_score            INTEGER NOT NULL DEFAULT 0,
  winner_registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'scheduled',
  scorekeeper_user_id   UUID,
  ruleset_code          TEXT NOT NULL DEFAULT 'TF_v1',
  ruleset_version       TEXT NOT NULL DEFAULT '1',
  match_number_label    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT match_status_check CHECK (status IN ('scheduled','running','paused','completed','voided'))
);

CREATE INDEX IF NOT EXISTS matches_status_idx ON matches (status);
CREATE INDEX IF NOT EXISTS matches_pool_id_idx ON matches (pool_id);
CREATE INDEX IF NOT EXISTS matches_lice_id_idx ON matches (lice_id);

-- ── Referee assignments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referee_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  scope_type      TEXT NOT NULL,
  lice_id         UUID REFERENCES lices(id) ON DELETE SET NULL,
  pool_id         UUID REFERENCES pools(id) ON DELETE SET NULL,
  match_id        UUID REFERENCES matches(id) ON DELETE SET NULL,
  role            TEXT,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'assigned',
  auto_assigned   BOOLEAN NOT NULL DEFAULT FALSE,
  conflicts_jsonb JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referee_assignment_scope_check CHECK (scope_type IN ('lice','pool','match'))
);

-- ── Match events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sequence    INTEGER NOT NULL,
  type        TEXT NOT NULL,
  reason      TEXT,
  by_user_id  UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, sequence)
);

-- ── Exchanges ─────────────────────────────────────────────────────────────────
-- THE source of truth for all scores. Never store computed scores independently.
CREATE TABLE IF NOT EXISTS exchanges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- client_uuid: idempotency key from the scoring tablet (offline-first safety)
  client_uuid           UUID NOT NULL UNIQUE,
  match_id              UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sequence              INTEGER NOT NULL,
  type                  TEXT NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_since_prev_ms INTEGER,
  first_striker_color   TEXT,
  first_strike_value    INTEGER,
  afterblow_value       INTEGER,
  no_exchange_reason    TEXT,
  red_score_delta       INTEGER NOT NULL DEFAULT 0,
  blue_score_delta      INTEGER NOT NULL DEFAULT 0,
  voided                BOOLEAN NOT NULL DEFAULT FALSE,
  voided_reason         TEXT,
  UNIQUE(match_id, sequence),
  CONSTRAINT exchange_type_check CHECK (type IN ('clean','afterblow','double','no_exchange')),
  CONSTRAINT exchange_first_striker_check CHECK (first_striker_color IN ('red','blue') OR first_striker_color IS NULL)
);

CREATE INDEX IF NOT EXISTS exchanges_match_id_idx ON exchanges (match_id);
CREATE INDEX IF NOT EXISTS exchanges_voided_idx ON exchanges (match_id, voided);

-- ── Workshops ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workshops (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  title             TEXT NOT NULL,
  short_description TEXT,
  description_md    TEXT,
  language          TEXT NOT NULL DEFAULT 'fr',
  level             TEXT NOT NULL DEFAULT 'all',
  prerequisites     TEXT,
  capacity          INTEGER,
  cover_image_url   TEXT,
  category          TEXT,
  status            TEXT NOT NULL DEFAULT 'draft',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, slug)
);

-- ── Workshop instructors ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workshop_instructors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id  UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  fighter_id   UUID REFERENCES fighters(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  bio          TEXT,
  photo_url    TEXT,
  affiliation  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- ── Workshop sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workshop_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id    UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,
  location_label TEXT,
  lice_id        UUID REFERENCES lices(id) ON DELETE SET NULL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'scheduled',
  CONSTRAINT workshop_session_status_check CHECK (status IN ('scheduled','running','completed','cancelled'))
);

-- ── Workshop enrollments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workshop_enrollments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_session_id UUID NOT NULL REFERENCES workshop_sessions(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL,
  status              TEXT NOT NULL DEFAULT 'intent',
  position            INTEGER,
  enrolled_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workshop_session_id, user_id),
  CONSTRAINT enrollment_status_check CHECK (status IN ('intent','confirmed','waitlisted','cancelled'))
);

-- ============================================================
-- End of 0001_init.sql
-- ============================================================
