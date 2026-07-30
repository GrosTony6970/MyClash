/**
 * subject-export.tables.ts — the table census behind the GDPR subject export.
 *
 * Art. 15 (right of access) and Art. 20 (portability) are only satisfiable if we
 * can say, table by table, what we hold about a person. 70+ tables carry a
 * user-identifying column, so a hand-maintained list rots on the next migration
 * and the export silently starts under-reporting — a compliance failure that
 * looks exactly like a complete export.
 *
 * `subject-export.coverage.test.ts` scans every migration for user-identifying
 * columns and fails CI until each table appears in exactly one of the two sets
 * below. Same anti-rot contract as ARCHIVE_COLLECTED_TABLES / _EXCLUDED_TABLES
 * in ../exports/archive.service.ts, for the same reason: nobody remembers to
 * update a list they are not forced to update.
 *
 * MAINTENANCE: a new table with a user_id / person_id / global_person_id column
 * fails the guard until you bucket it here. Buckets are a judgement about the
 * DATA SUBJECT, not about convenience — if a row describes a person, it belongs
 * in the export even when that is inconvenient.
 */

/**
 * How a table's rows are reached from a data subject.
 *
 * The three reaches are NOT interchangeable and conflating them is the main
 * correctness risk in this module:
 *  - `uid`           column holds an auth.users id.
 *  - `global_person` column holds a global_persons.id (cross-event identity).
 *  - `person`        column holds a persons.id (the EVENT-SCOPED roster row).
 *
 * The trap: `workshop_enrollments.user_id` is named like a uid but holds a
 * persons.id — guests carry a persons.id with no account at all. Reading it as
 * a uid exports nothing; reading some other table's persons.id as a uid exports
 * A DIFFERENT PERSON'S ROWS. Both failures are silent, which is why the reach is
 * declared per column here rather than inferred from the column name.
 */
export type SubjectReach = 'uid' | 'global_person' | 'person';

export interface SubjectReachSpec {
  column: string;
  reach: SubjectReach;
}

export interface SubjectTableSpec {
  /** Every way a row in this table can point directly at the subject. */
  reaches: readonly SubjectReachSpec[];
  /** Bundle entry these rows land in. */
  file: string;
  /**
   * Set when rows ALSO reach the subject indirectly (through a match,
   * registration, …). The guard does not check this; the service implements it
   * and its tests pin it. Recorded here so the two stay legible together.
   */
  note?: string;
}

/**
 * Inbound social edges — who follows the subject — are deliberately NOT a reach.
 *
 * `follows.followed_person_id` and `directory_follows.followed_global_person_id`
 * identify OTHER people. Disclosing them under the subject's access request
 * would hand over third-party personal data, which Art. 15(4) explicitly guards
 * against. The subject's own outbound follows are exported in full.
 */
export const SUBJECT_EXPORT_TABLES: Readonly<Record<string, SubjectTableSpec>> = {
  // ── Identity & profile ──────────────────────────────────────────────────────
  fighters: { reaches: [{ column: 'claimed_by_user_id', reach: 'uid' }], file: 'profile.json' },
  referee_profiles: {
    reaches: [{ column: 'global_person_id', reach: 'global_person' }],
    file: 'profile.json',
  },
  fighter_manual_medals: {
    reaches: [{ column: 'global_person_id', reach: 'global_person' }],
    file: 'profile.json',
  },
  person_privacy: { reaches: [{ column: 'person_id', reach: 'person' }], file: 'profile.json' },
  fighter_clubs: {
    reaches: [{ column: 'global_person_id', reach: 'global_person' }],
    file: 'profile.json',
  },
  fighter_weapons: {
    reaches: [{ column: 'global_person_id', reach: 'global_person' }],
    file: 'profile.json',
  },
  persons: { reaches: [{ column: 'claimed_by_user_id', reach: 'uid' }], file: 'events.csv' },
  guest_sessions: {
    reaches: [{ column: 'person_id', reach: 'person' }],
    file: 'account.json',
    note: 'Holds ip_first_seen + user_agent — device telemetry, deleted outright on erasure.',
  },

  // ── Roles & memberships ─────────────────────────────────────────────────────
  organization_members: { reaches: [{ column: 'user_id', reach: 'uid' }], file: 'account.json' },
  platform_roles: { reaches: [{ column: 'user_id', reach: 'uid' }], file: 'account.json' },
  league_user_roles: { reaches: [{ column: 'user_id', reach: 'uid' }], file: 'account.json' },

  // ── Competition participation ───────────────────────────────────────────────
  registrations: {
    reaches: [{ column: 'person_id', reach: 'person' }],
    file: 'events.csv',
  },
  matches: {
    reaches: [
      { column: 'scorekeeper_user_id', reach: 'uid' },
      { column: 'locked_by_user_id', reach: 'uid' },
      // Assigned referee. Named neither *_user_id nor *_person_id, but it
      // REFERENCES persons(id) — the reason the coverage guard scans foreign
      // keys as well as column names.
      { column: 'referee_id', reach: 'person' },
    ],
    file: 'matches.csv',
    note: 'Matches the subject FOUGHT are reached via registrations → red/blue_registration_id, not by these columns.',
  },
  match_events: {
    reaches: [{ column: 'by_user_id', reach: 'uid' }],
    file: 'exchanges.csv',
    note: 'by_user_id is who ENTERED the exchange; exchanges in the subject’s own matches are reached via matches.',
  },
  match_penalties: {
    reaches: [{ column: 'by_user_id', reach: 'uid' }],
    file: 'penalties.csv',
    note: 'by_user_id is the ISSUER; penalties RECEIVED by the subject are reached via matches.',
  },
  match_forfeits: {
    reaches: [
      { column: 'by_user_id', reach: 'uid' },
      { column: 'voided_by_user_id', reach: 'uid' },
    ],
    file: 'matches.csv',
    note: 'Forfeits BY the subject as a competitor are reached via matches.',
  },

  // ── Refereeing & staffing ───────────────────────────────────────────────────
  // No `user_id` reach on the three referee tables: migration 0063 collapsed
  // their dual identity down to person_id and DROPPED the column. Reading it
  // 400s in PostgREST, which `fetchDirect` turns into a 500 for the whole
  // bundle — the subject loses everything, not just their referee rows. The
  // subject is still fully reached: `person` resolves through
  // global_persons.claimed_by_user_id, which is what 0063 made the canonical
  // route. Pinned by subject-export.schema.test.ts.
  referee_assignments: {
    reaches: [{ column: 'person_id', reach: 'person' }],
    file: 'referee-assignments.csv',
  },
  referee_qualifications: {
    reaches: [
      { column: 'global_person_id', reach: 'global_person' },
      { column: 'person_id', reach: 'person' },
    ],
    file: 'referee-assignments.csv',
  },
  referee_compensation_payments: {
    // person_id since migration 0163 (it was the auth uid before), so this
    // reaches the subject as a global person like the rest of referee-land.
    reaches: [{ column: 'person_id', reach: 'global_person' }],
    file: 'referee-assignments.csv',
  },
  event_referees: {
    reaches: [{ column: 'person_id', reach: 'person' }],
    file: 'referee-assignments.csv',
  },
  event_referee_days: {
    reaches: [{ column: 'person_id', reach: 'person' }],
    file: 'referee-assignments.csv',
  },
  event_referee_tournaments: {
    reaches: [{ column: 'person_id', reach: 'person' }],
    file: 'referee-assignments.csv',
  },

  // ── Workshops ───────────────────────────────────────────────────────────────
  workshop_enrollments: {
    reaches: [
      // NOT a uid. See the trap in the SubjectReach docblock.
      { column: 'user_id', reach: 'person' },
      { column: 'global_person_id', reach: 'global_person' },
    ],
    file: 'workshops.csv',
  },
  workshop_feedback: {
    reaches: [{ column: 'rater_person_id', reach: 'person' }],
    file: 'workshops.csv',
  },
  event_instructors: {
    reaches: [{ column: 'person_id', reach: 'person' }],
    file: 'workshops.csv',
  },
  workshop_instructors: {
    reaches: [{ column: 'global_person_id', reach: 'global_person' }],
    file: 'workshops.csv',
  },

  // ── League standing ─────────────────────────────────────────────────────────
  // `fighter_id` here is a global_persons.id: `fighters` was renamed to
  // `global_persons` in 0023 but these two columns kept the old NAME (unlike
  // fighter_clubs / fighter_weapons / workshop_instructors, which were renamed).
  league_rankings: {
    reaches: [{ column: 'fighter_id', reach: 'global_person' }],
    file: 'leagues.csv',
  },
  league_tournament_results: {
    reaches: [{ column: 'fighter_id', reach: 'global_person' }],
    file: 'leagues.csv',
  },

  // ── Social graph (outbound only — see the note above) ───────────────────────
  follows: { reaches: [{ column: 'follower_user_id', reach: 'uid' }], file: 'follows.csv' },
  directory_follows: {
    reaches: [{ column: 'follower_user_id', reach: 'uid' }],
    file: 'follows.csv',
  },
  organization_follows: {
    reaches: [{ column: 'follower_user_id', reach: 'uid' }],
    file: 'follows.csv',
  },
  directory_groups: { reaches: [{ column: 'owner_user_id', reach: 'uid' }], file: 'follows.csv' },
  directory_group_members: {
    reaches: [{ column: 'global_person_id', reach: 'global_person' }],
    file: 'follows.csv',
  },

  // ── Notifications ───────────────────────────────────────────────────────────
  notification_preferences: {
    reaches: [{ column: 'user_id', reach: 'uid' }],
    file: 'notifications.csv',
  },
  push_subscriptions: {
    reaches: [{ column: 'user_id', reach: 'uid' }],
    file: 'notifications.csv',
  },
  event_broadcast_recipients: {
    reaches: [
      { column: 'user_id', reach: 'uid' },
      { column: 'person_id', reach: 'person' },
    ],
    file: 'notifications.csv',
  },

  // ── The subject's own requests ──────────────────────────────────────────────
  global_person_claim_requests: {
    reaches: [
      { column: 'user_id', reach: 'uid' },
      { column: 'global_person_id', reach: 'global_person' },
    ],
    file: 'requests.csv',
  },
  person_email_change_requests: {
    reaches: [{ column: 'user_id', reach: 'uid' }],
    file: 'requests.csv',
  },
  league_membership_requests: {
    reaches: [{ column: 'requested_by_user_id', reach: 'uid' }],
    file: 'requests.csv',
  },
  club_review_requests: {
    reaches: [{ column: 'requester_user_id', reach: 'uid' }],
    file: 'requests.csv',
  },
  exchange_edit_requests: {
    reaches: [{ column: 'requested_by_user_id', reach: 'uid' }],
    file: 'requests.csv',
  },

  // ── AI features the subject used ────────────────────────────────────────────
  fighter_ai_settings: {
    reaches: [{ column: 'global_person_id', reach: 'global_person' }],
    file: 'ai.csv',
  },
  fighter_ai_usage_log: {
    reaches: [{ column: 'global_person_id', reach: 'global_person' }],
    file: 'ai.csv',
  },
  platform_ai_usage_log: { reaches: [{ column: 'actor_user_id', reach: 'uid' }], file: 'ai.csv' },
  organizer_chat_conversations: {
    reaches: [{ column: 'created_by_user_id', reach: 'uid' }],
    file: 'ai.csv',
  },
  organizer_ai_assistant_drafts: {
    reaches: [{ column: 'actor_user_id', reach: 'uid' }],
    file: 'ai.csv',
  },
  ai_generated_content: {
    reaches: [{ column: 'generated_by_user_id', reach: 'uid' }],
    file: 'ai.csv',
  },
  tournament_query_history: { reaches: [{ column: 'user_id', reach: 'uid' }], file: 'ai.csv' },

  // ── Governance ──────────────────────────────────────────────────────────────
  audit_log: {
    reaches: [{ column: 'actor_user_id', reach: 'uid' }],
    file: 'audit.csv',
    note: 'Actions the subject took. Covers their authorship of the org assets excluded below.',
  },
};

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
  'ai_data_quality_scans', // super-admin data-quality operations
  'ai_data_quality_findings',

  // retired
  'ruleset_submissions', // dead intake path, retired in the R3 review-queue consolidation
]);

export const SUBJECT_EXPORT_COLLECTED_TABLES = new Set<string>(Object.keys(SUBJECT_EXPORT_TABLES));
