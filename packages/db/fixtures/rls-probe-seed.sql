-- rls-probe-seed.sql — the rows `scripts/db-rls-probe.mjs` reads as an anonymous visitor.
--
-- The probe runs it as the migrating role (so RLS does not apply to the inserts) inside one
-- transaction it always rolls back: nothing here survives the probe, and a collision fails it
-- loudly rather than being skipped.
--
-- Why these rows. A policy runs per row: an empty table never evaluates its policy, and a loop
-- hides. Each row below makes a policy take a branch that once looped or leaked:
--   - ONE platform role. Most read policies start with `is_super_admin()`, which read
--     `platform_roles`, whose policy called back into it: with this row, every anonymous read
--     errored ("stack depth limit exceeded"), public Events included (fixed by 0201). A probe
--     without it said public reads worked.
--   - a club member, a draft Event and its bout, a private League and a club's private penalty
--     ruleset: each is hidden from anon, and deciding so reads a guarded table.

INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
INSERT INTO organizations (id, slug, name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'rls-probe-club', 'RLS Probe Club');
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'admin');
INSERT INTO platform_roles (user_id, role) VALUES
  ('22222222-2222-4222-8222-222222222222', 'super_admin');
INSERT INTO events (id, organization_id, slug, name, start_date, end_date, status, event_kind) VALUES
  ('eeeeeeee-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'rls-probe-open',
   'Open', '2026-10-01', '2026-10-01', 'published', 'standard'),
  ('eeeeeeee-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001', 'rls-probe-draft',
   'Draft', '2026-10-01', '2026-10-01', 'draft', 'standard');
INSERT INTO tournaments (id, event_id, slug, name, status) VALUES
  ('77777777-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-00000000000a', 'ls', 'LS', 'published'),
  ('77777777-0000-4000-8000-00000000000b', 'eeeeeeee-0000-4000-8000-00000000000b', 'ls', 'LS', 'draft');
INSERT INTO phases (id, tournament_id, type) VALUES
  ('99999999-0000-4000-8000-00000000000a', '77777777-0000-4000-8000-00000000000a', 'pool'),
  ('99999999-0000-4000-8000-00000000000b', '77777777-0000-4000-8000-00000000000b', 'pool');
INSERT INTO matches (id, phase_id) VALUES
  ('dddddddd-0000-4000-8000-00000000000a', '99999999-0000-4000-8000-00000000000a'),
  ('dddddddd-0000-4000-8000-00000000000b', '99999999-0000-4000-8000-00000000000b');
INSERT INTO leagues (id, slug, name, season_year, public_visibility) VALUES
  ('1eaa0000-0000-4000-8000-00000000000a', 'rls-probe-public', 'Public', 2026, true),
  ('1eaa0000-0000-4000-8000-00000000000b', 'rls-probe-private', 'Private', 2026, false);
INSERT INTO penalty_rulesets (id, code, version, name, owner_organization_id, built_in, public_visibility) VALUES
  ('fe000000-0000-4000-8000-00000000000a', 'rls-probe-club', '1', 'Club', 'aaaaaaaa-0000-4000-8000-000000000001',
   false, false);
