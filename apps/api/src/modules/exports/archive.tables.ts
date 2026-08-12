/**
 * archive.tables.ts — the organizer archive's table list. The only one.
 *
 * Every table an archive carries is declared here exactly once, and the six
 * things the archive used to be told separately are derived from this record:
 * the envelope key, the empty snapshot, the table→key map, the insert order,
 * the JSON id paths and the id map. Adding a table is one entry.
 *
 * It used to be six declarations across two files. They agreed — but two of
 * them failed SILENTLY when missed. A table absent from `INSERT_ORDER` was
 * exported and then never inserted on restore; a table nobody added a `collect`
 * call for was carried as an empty array. Every gate stayed green in both
 * cases, because nothing cross-checked one list against another. Now there is
 * only one list to be wrong about, and being wrong about it is a type error.
 *
 * **DECLARATION ORDER IS INSERT ORDER.** Parents before children, FK-dependency
 * order — the sequence `insertMappedTables` walks. Moving an entry moves when
 * its rows are written, so the ordering notes below are load-bearing, not
 * decoration.
 *
 * Same anti-rot contract as SUBJECT_EXPORT_TABLES in
 * ../privacy/subject-export.tables.ts, which copied it from here when the
 * archive still kept two sets. `archive.migration-coverage.test.ts` scans every
 * migration and fails CI until a new event/tournament/phase-scoped table is
 * either declared below or listed in ARCHIVE_EXCLUDED_TABLES.
 */
import type { ArchiveRow, ArchiveTableSpec, IdMapName, JsonIdPath } from './archive.table-spec';

const TABLES = {
  // ── Event root and its immediate children ─────────────────────────────────
  events: { key: 'events', idMap: 'events' },
  themes: { key: 'themes', idMap: 'themes' },
  lices: { key: 'lices', idMap: 'lices' },
  persons: { key: 'persons', idMap: 'persons' },
  person_privacy: { key: 'personPrivacy' },

  // referee_skills before anything that stores a skill id: event_hidden_skills,
  // both slot-config skill joins, and referee_assignments.role — which holds a
  // referee_skills.id rather than a role name.
  referee_skills: { key: 'refereeSkills', idMap: 'refereeSkills' },
  referee_qualifications: { key: 'refereeQualifications' },

  // event_referees before its per-tournament / per-day allowlists.
  event_referees: { key: 'eventReferees' },
  event_hidden_skills: { key: 'eventHiddenSkills' },
  event_instructors: { key: 'eventInstructors' },
  pool_assignment_settings: { key: 'poolAssignmentSettings' },

  // Slot configs before their allowed-skill joins.
  event_slot_config_default: { key: 'eventSlotConfigDefault', idMap: 'eventSlotConfig' },
  event_slot_config_default_skills: { key: 'eventSlotConfigDefaultSkills' },
  referee_compensation_event_settings: { key: 'refereeCompensationEventSettings' },
  event_venues: { key: 'eventVenues' },

  // ── Tournament and its structure ──────────────────────────────────────────
  tournaments: { key: 'tournaments', idMap: 'tournaments' },
  tournament_phase_venues: { key: 'tournamentPhaseVenues' },
  tournament_slot_config: { key: 'tournamentSlotConfig', idMap: 'tournamentSlotConfig' },
  tournament_slot_allowed_skills: { key: 'tournamentSlotAllowedSkills' },
  event_referee_tournaments: { key: 'eventRefereeTournaments' },
  event_referee_days: { key: 'eventRefereeDays' },
  registrations: { key: 'registrations', idMap: 'registrations' },

  phases: {
    key: 'phases',
    idMap: 'phases',
    // phases.service.ts stamps `config_json.bronzeSlotId`, which is a
    // bracket_slots.id inserted LATER. The id maps are all pre-seeded before
    // any row is rewritten precisely so this forward reference resolves.
    json: [{ path: 'config_json.bronzeSlotId', map: 'bracketSlots' }],
  },
  pools: { key: 'pools', idMap: 'pools' },
  pool_members: { key: 'poolMembers' },
  bracket_slots: { key: 'bracketSlots', idMap: 'bracketSlots' },
  swiss_entrants: { key: 'swissEntrants' },

  swiss_rounds: {
    key: 'swissRounds',
    idMap: 'swissRounds',
    // Before `matches`: a match carries swiss_round_id, so the round it points
    // at has to exist first or the FK remaps to null and the round loses its
    // bouts.
    //
    // Paths read off swiss-pairing.service.ts `commitNextRound`
    // (warnings/ranked) and swiss-override.service.ts `recordAdjustment`, whose
    // entries come in TWO shapes: a `swap` carrying a/bRegistrationId, and a
    // `set-sides` carrying matchId plus from/to side pairs. `byUserId` is
    // deliberately absent — it is an auth user, not an event-scoped row.
    json: [
      { path: 'pairing_meta_json.ranked[]', map: 'registrations' },
      { path: 'pairing_meta_json.warnings[].registrationIds[]', map: 'registrations' },
      { path: 'pairing_meta_json.manualAdjustments[].aRegistrationId', map: 'registrations' },
      { path: 'pairing_meta_json.manualAdjustments[].bRegistrationId', map: 'registrations' },
      { path: 'pairing_meta_json.manualAdjustments[].matchId', map: 'matches' },
      { path: 'pairing_meta_json.manualAdjustments[].from.red', map: 'registrations' },
      { path: 'pairing_meta_json.manualAdjustments[].from.blue', map: 'registrations' },
      { path: 'pairing_meta_json.manualAdjustments[].to.red', map: 'registrations' },
      { path: 'pairing_meta_json.manualAdjustments[].to.blue', map: 'registrations' },
      {
        path: 'pairing_meta_json.manualAdjustments[].warnings[].registrationIds[]',
        map: 'registrations',
      },
    ],
  },

  // ── Scoring ───────────────────────────────────────────────────────────────
  matches: { key: 'matches', idMap: 'matches' },
  referee_assignments: { key: 'refereeAssignments' },
  match_events: { key: 'matchEvents' },
  exchanges: { key: 'exchanges', idMap: 'exchanges' },
  match_penalties: { key: 'matchPenalties', idMap: 'matchPenalties' },

  match_forfeits: {
    key: 'matchForfeits',
    idMap: 'matchForfeits',
    // Read off match-forfeits.service.ts `matchSnapshot` / `loadRegistration`.
    // The two `*_match_state` blobs are the same snapshot shape, so both carry
    // the winner; 0186 added the post-state so a void can tell whether the
    // match still holds the result the record produced.
    json: [
      { path: 'downstream_match_ids[]', map: 'matches' },
      { path: 'previous_match_state.winner_registration_id', map: 'registrations' },
      { path: 'resulting_match_state.winner_registration_id', map: 'registrations' },
      { path: 'previous_registration_state.id', map: 'registrations' },
    ],
  },
  tournament_penalty_reviews: {
    key: 'tournamentPenaltyReviews',
    // penalties.service.ts `createSecondBlackCardReviewIfNeeded` stores the
    // match_penalties.ids that triggered the review. No FK is declared on them,
    // so nothing would ever have complained about a copy naming another event's
    // cards.
    json: [{ path: 'payload_json.penaltyIds[]', map: 'matchPenalties' }],
  },

  // ── Workshops and the programme ───────────────────────────────────────────
  // Tournaments and workshops both precede event_programme_blocks, which
  // references them by competition_id / workshop_id.
  workshops: { key: 'workshops', idMap: 'workshops' },
  workshop_instructors: { key: 'workshopInstructors' },
  workshop_sessions: { key: 'workshopSessions', idMap: 'workshopSessions' },
  workshop_enrollments: { key: 'workshopEnrollments' },
  workshop_breaks: { key: 'workshopBreaks' },
  event_programme_blocks: { key: 'eventProgrammeBlocks' },
} as const satisfies Record<string, ArchiveTableSpec>;

export const ARCHIVE_TABLES: Readonly<Record<string, ArchiveTableSpec>> = TABLES;

/** A table name as the database spells it. */
export type ArchiveTableName = keyof typeof TABLES;

/** A table's camelCase member in the archive envelope. */
export type ArchiveKey = (typeof TABLES)[ArchiveTableName]['key'];

/**
 * Parents before children, walked in this order on insert.
 *
 * Derived from the declaration order rather than kept beside it: the pair used
 * to be maintained by hand, and a table missing from the order was exported and
 * then silently never restored.
 */
export const INSERT_ORDER = Object.keys(TABLES) as ArchiveTableName[];

export const TABLE_TO_ARCHIVE_KEY = Object.fromEntries(
  INSERT_ORDER.map((table) => [table, TABLES[table].key]),
) as Record<ArchiveTableName, ArchiveKey>;

export const ARCHIVE_COLLECTED_TABLES = new Set<string>(INSERT_ORDER);

export const JSON_ID_PATHS = Object.fromEntries(
  INSERT_ORDER.filter((table) => (TABLES[table] as ArchiveTableSpec).json !== undefined).map(
    (table) => [table, (TABLES[table] as ArchiveTableSpec).json],
  ),
) as Partial<Record<ArchiveTableName, readonly JsonIdPath[]>>;

const NO_PATHS: readonly JsonIdPath[] = [];

export function jsonIdPathsFor(table: ArchiveTableName): readonly JsonIdPath[] {
  return JSON_ID_PATHS[table] ?? NO_PATHS;
}

/**
 * The named id map this table's primary key uses, or undefined for the lazily
 * created per-table map. See ID_MAP_NAMES for what earns a name.
 */
export function idMapNameForTable(table: ArchiveTableName): IdMapName | undefined {
  return ARCHIVE_TABLES[table]?.idMap;
}

/**
 * A fresh, empty snapshot.
 *
 * A function rather than a shared constant: the constant's arrays were spread
 * into every snapshot, so two archives being built in the same process held the
 * same empty array for every table neither of them filled. Nothing pushes into
 * one today — every collector assigns — but the hazard cost nothing to remove.
 */
export function emptyArchiveTables(): Record<ArchiveKey, ArchiveRow[]> {
  return Object.fromEntries(
    INSERT_ORDER.map((table) => [TABLES[table].key, [] as ArchiveRow[]]),
  ) as unknown as Record<ArchiveKey, ArchiveRow[]>;
}

/**
 * Tables that carry an `event_id`/`tournament_id` (directly, or as a scoped
 * child) but are DELIBERATELY not part of an organizer archive. The
 * migration-scanning guard test asserts every scoped table is either declared
 * above or listed here, so a newly added scoped table fails CI until someone
 * consciously buckets it. Reasons, per group:
 *  - org-level catalogues shared across events (copied by reference, resolve
 *    on same-org restore): venues + rulesets + compensation plans, etc.
 *  - league data is cross-event and recomputed, not part of one event.
 *  - operational / derived / credential / notification / AI rows that must
 *    not clone into a restored copy.
 */
export const ARCHIVE_EXCLUDED_TABLES = new Set<string>([
  // org-level catalogues (referenced by id; exist independently of the event)
  'venues',
  'venue_areas',
  'venue_lices',
  'penalty_rulesets',
  'penalty_ruleset_entries',
  'custom_rulesets',
  'custom_ruleset_versions',
  'league_scoring_systems',
  'league_scoring_system_versions',
  'referee_compensation_plans',
  'referee_compensation_role_rates',
  'referee_compensation_tiers',
  // league data (cross-event; recomputed from results)
  'leagues',
  'league_organization_roles',
  'league_user_roles',
  'league_groups',
  'league_tournament_links',
  'league_tournament_results',
  'league_rankings',
  'league_membership_requests',
  // operational / derived / credential / notification / AI
  'event_staff_accounts',
  'event_staff_lice_assignments',
  // Who physically walked in the door on the day. Operational, not part of the
  // competitive record — and both its actor columns reference
  // event_staff_accounts, which is excluded two lines up, so a restored arrival
  // could only ever point at an actor that no longer exists. It IS personal
  // data, so it appears in the GDPR subject export instead (see
  // subject-export.service.ts); excluded here means "not part of an event
  // archive", never "not reachable by its subject".
  'event_arrivals',
  // Per-weapon equipment checks. Same reasoning as event_arrivals directly
  // above: event-day operations rather than the competitive record, and its
  // checker column references event_staff_accounts, which is excluded. Also in
  // the GDPR subject export, for the same reason arrivals are.
  'event_gear_checks',
  // Event pass tokens. Excluded for a stronger reason than the two above: an
  // archive is a file that gets copied, mailed and kept, and this table is a
  // credential store. Even hashed, live secrets have no business in a portable
  // copy of an event, and a restored archive re-issuing everyone's old pass
  // would be worse still. Nothing is lost — a pass is a faster way to type a
  // name, never part of the competitive record. It IS in the GDPR subject
  // export, which asks the other question.
  'event_passes',
  'event_broadcast_notifications',
  'event_broadcast_recipients',
  'tournament_query_settings',
  'tournament_query_history',
  'referee_compensation_payments',
  'exchange_edit_requests',
  'deletion_requests',
  'tournament_ruleset_repins', // mid-event re-pin audit; governance log, not archived event data
  // Per-device sync heartbeat: describes the TABLETS that ran the event, not
  // the event. Restoring it into a copy would claim devices that never synced
  // to that copy, and its whole value is being current rather than historical.
  'scoring_device_sync_reports',
  // Feedback is given TO an organiser about one running of an event, under a
  // promise of anonymity from that organiser. An archive is copied, restored
  // into new events and handed around; carrying opinions into a copy would move
  // them further from the promise they were given under with every hop. The
  // author still gets their own rows through the GDPR subject export.
  'event_feedback',
  'organizer_ai_assistant_drafts',
  'organizer_chat_conversations',
  'organizer_chat_messages',
  'ai_usage_log',
  'ai_data_quality_findings',
  'ai_data_quality_scans',
  'organization_ai_settings',
  'ai_generated_content', // regenerable AI output, not source data

  'follows', // user social graph, not event data
  'club_review_requests', // club-verification workflow, not event data
  'workshop_feedback', // post-event participant ratings/comments; sentiment, not structural event data
]);
