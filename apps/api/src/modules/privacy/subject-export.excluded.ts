/**
 * subject-export.excluded.ts — the tables the GDPR subject export leaves out, each with its
 * reason. Split from subject-export.tables.ts (the census stays there and re-exports this set),
 * so the census has room to grow. `subject-export.coverage.test.ts` holds both sets to the
 * migrations.
 */

/**
 * Tables carrying a user-identifying column that are deliberately NOT exported.
 *
 * Every entry needs a reason. "Not about the subject" is the only good one — an
 * exclusion because a table is awkward to join is a compliance gap wearing a
 * comment. Reasons, per group:
 *
 *  - CREDENTIAL MATERIAL: secrets, not meaningful personal data. Handing back a
 *    token hash or an encrypted API key discloses nothing about the person and
 *    weakens the flow it protects. All are deleted outright on erasure.
 *
 *  - ORG / PLATFORM ASSETS: the subject appears only as author, publisher or
 *    reviewer. The row is about an event, ruleset or a THIRD PARTY'S request,
 *    not about the subject. Their authorship is not lost — `audit_log` is
 *    exported and records exactly which of these actions they took.
 *
 *  - RETIRED: table no longer written by any code path.
 */
export const SUBJECT_EXPORT_EXCLUDED_TABLES = new Set<string>([
  // credential material
  'global_person_claim_tokens',
  'admin_user_temp_passwords',
  'fighter_ai_keys',
  'organization_ai_keys',
  'platform_ai_keys',

  // org / platform assets the subject merely authored, published or reviewed
  'events',
  'organizations',
  'leagues',
  'phases',
  'custom_rulesets',
  'custom_ruleset_versions',
  'penalty_rulesets',
  'penalty_ruleset_versions',
  'league_scoring_systems',
  'league_scoring_system_versions',
  'league_tournament_links',
  'tournament_query_settings',
  'tournament_ruleset_repins',
  'platform_ai_settings',
  'feature_flags',
  'event_staff_accounts', // a staff PIN account is not an auth user; the subject only created it
  'event_broadcast_notifications', // the org's outgoing message; the subject's RECIPIENT row is exported
  'deletion_requests', // event-lifecycle protection raised by an org admin for the org
  'tournament_penalty_reviews', // an organiser's review of a penalty; the penalty itself is exported
  // The round itself is the organiser's structure, not the subject's data — a
  // pairing table for a whole field. The subject's own place in it IS exported:
  // swiss_entrants above, and their bouts through matches.
  'swiss_rounds',
  'ai_data_quality_scans', // super-admin data-quality operations
  'ai_data_quality_findings',

  // FightBook safety flags: what only admins know. To the flagged subject it would reveal the
  // flag (Art. 15(4)); to the reporter, the handled mark and another person's account id.
  'spar_flag_admin',

  // FightBook QR codes: sha256 hashes of a code shown on a phone for five minutes. The hash is
  // credential material, it discloses nothing about the person, and the row is gone within the hour.
  'fightbook_qr_codes',

  // renamed away — the name survives only in pre-rename migration text
  'fighters', // renamed to global_persons in 0023, which IS exported

  // retired
  'ruleset_submissions', // dead intake path, retired in the R3 review-queue consolidation
]);
