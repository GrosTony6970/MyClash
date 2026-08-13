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
import type {
  ArchiveRow,
  ArchiveTableSpec,
  CollectRule,
  IdMapName,
  JsonIdPath,
  SharedFkColumn,
} from './archive.table-spec';

/** The row(s) the caller already holds — the event, and the tournament in tournament scope. */
const ROOT = { from: 'root' } as const satisfies CollectRule;
/** `eq('event_id', …)` on the event being archived. */
const EVENT_SCOPED = { from: 'event' } as const satisfies CollectRule;
const BY_TOURNAMENT = {
  from: 'tournaments',
  local: 'tournament_id',
} as const satisfies CollectRule;
const BY_PHASE = { from: 'phases', local: 'phase_id' } as const satisfies CollectRule;
const BY_MATCH_SCORING = {
  from: 'matches',
  local: 'match_id',
  include: 'scoring',
} as const satisfies CollectRule;

/**
 * A tournament archive takes the event's pool-assignment settings, but only the
 * rows that are the event default (no tournament) or this tournament's own.
 */
const TOURNAMENT_POOL_SETTINGS = {
  from: 'event',
  needs: ['tournaments'],
  filter: (row, ctx) =>
    !row['tournament_id'] || ctx.tournamentIds.includes(row['tournament_id'] as string),
} as const satisfies CollectRule;

/**
 * Referee assignments are event-scoped, so a tournament archive has to pick out
 * the ones pointing at a pool or a match it actually carries. In a
 * structure-only archive there are no matches, so only the pool assignments
 * survive — which is the same answer the hand-written collector gave.
 */
const TOURNAMENT_REFEREE_ASSIGNMENTS = {
  from: 'event',
  needs: ['pools', 'matches'],
  filter: (row, ctx) =>
    (typeof row['pool_id'] === 'string' && ctx.idsOf('pools').includes(row['pool_id'])) ||
    (typeof row['match_id'] === 'string' && ctx.idsOf('matches').includes(row['match_id'])),
} as const satisfies CollectRule;

/**
 * FK columns swept on EVERY table, because the column name means the same thing
 * wherever it appears. A column whose meaning depends on the table it is on
 * belongs in that table's own `fk` instead.
 *
 * `target` names the restore target an unmapped value falls back to: an
 * `event_id` with no entry in the map becomes the event being restored into,
 * which is what re-parents a copy.
 */
export const SHARED_FK_COLUMNS: Readonly<Record<string, SharedFkColumn>> = {
  event_id: { map: 'events', target: 'event' },
  lice_id: { map: 'lices' },
  person_id: { map: 'persons' },
  // `matches.referee_id` is an EVENT-SCOPED persons.id (migration 0039), not a
  // global person — so it has to be remapped like any other person reference.
  // Left unmapped, a restored match pointed at the SOURCE event's person row:
  // delete the source and `ON DELETE SET NULL` silently dropped the referee,
  // keep it and the referee dashboard listed the copy's match under the wrong
  // event's person (assignments.service.ts reads this column directly).
  referee_id: { map: 'persons' },
  // A global person is NOT archived, so this map stays empty and the id passes
  // through — correct, because it names a row that exists outside the copy.
  global_person_id: { map: 'fighters' },
  tournament_id: { map: 'tournaments', target: 'tournament' },
  competition_id: { map: 'tournaments' },
  registration_id: { map: 'registrations' },
  red_registration_id: { map: 'registrations' },
  blue_registration_id: { map: 'registrations' },
  winner_registration_id: { map: 'registrations' },
  forfeiting_registration_id: { map: 'registrations' },
  replacement_registration_id: { map: 'registrations' },
  registration_a_id: { map: 'registrations' },
  registration_b_id: { map: 'registrations' },
  // `swiss_rounds.bye_registration_id`. Missed when the Swiss tables were
  // registered, and silently: the FK points at `registrations(id)` and the
  // SOURCE row still exists, so the constraint is satisfied and the restore
  // succeeds with the copy's byes pointing into another event. The bye holder
  // then renders blank everywhere — and their bye points vanish from the
  // restored standings, because `swissRecords` credits `points.bye` by
  // matching this id against the phase's own entrants.
  bye_registration_id: { map: 'registrations' },
  phase_id: { map: 'phases' },
  pool_id: { map: 'pools' },
  bracket_slot_id: { map: 'bracketSlots' },
  swiss_round_id: { map: 'swissRounds' },
  match_id: { map: 'matches' },
  workshop_id: { map: 'workshops' },
  workshop_session_id: { map: 'workshopSessions' },
};

const TABLES = {
  // ── Event root and its immediate children ─────────────────────────────────
  events: { key: 'events', collect: { event: ROOT, tournament: ROOT }, idMap: 'events' },
  themes: { key: 'themes', collect: { event: EVENT_SCOPED, tournament: 'omit' }, idMap: 'themes' },
  lices: {
    key: 'lices',
    collect: { event: EVENT_SCOPED, tournament: EVENT_SCOPED },
    // `area_id` (0169) references venue_areas, which hang off a venue owned by
    // the source org — so it leaks exactly like `venue_id` beside it, and was
    // missed because the column gate was matching remapped names globally
    // rather than per table: one table nulling `venue_id` waved it through
    // everywhere, and `area_id` rode in on workshop_sessions.
    crossOrg: { null: ['venue_id', 'area_id'] },
    idMap: 'lices',
  },
  persons: {
    key: 'persons',
    collect: {
      event: EVENT_SCOPED,
      tournament: { from: 'registrations', local: 'id', parent: 'person_id' },
    },
    // A restored copy is a fresh event: nobody has claimed its people yet, and
    // inheriting a claim would hand the copy's rows to whoever claimed the
    // source's.
    set: { claim_status: 'unclaimed', claimed_by_user_id: null },
    idMap: 'persons',
  },
  person_privacy: {
    key: 'personPrivacy',
    collect: {
      event: { from: 'persons', local: 'person_id' },
      tournament: { from: 'persons', local: 'person_id' },
    },
  },

  // referee_skills before anything that stores a skill id: event_hidden_skills,
  // both slot-config skill joins, and referee_assignments.role — which holds a
  // referee_skills.id rather than a role name.
  referee_skills: {
    key: 'refereeSkills',
    // Collected in TOURNAMENT scope too, which it was not. referee_assignments
    // and tournament_slot_allowed_skills both travel in a tournament archive
    // and both hold a referee_skills.id, so with this omitted the id map was
    // empty and those ids passed through unchanged — correct when restoring
    // into the same event, and a reference to ANOTHER event's custom skill when
    // restoring into a different one. `restoreTournamentCopy` self-maps and
    // drops these rows in the same-event case, exactly as it does for persons.
    //
    // System skills carry `event_id IS NULL` (0041's CHECK), so the event_id
    // filter never picks them up and they keep passing through, which is right:
    // they are shared by every event.
    collect: { event: EVENT_SCOPED, tournament: EVENT_SCOPED },
    idMap: 'refereeSkills',
  },
  referee_qualifications: {
    key: 'refereeQualifications',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
  },

  // event_referees before its per-tournament / per-day allowlists.
  event_referees: { key: 'eventReferees', collect: { event: EVENT_SCOPED, tournament: 'omit' } },
  event_hidden_skills: {
    key: 'eventHiddenSkills',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
    skillIdColumns: ['skill_id'],
  },
  event_instructors: {
    key: 'eventInstructors',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
  },
  pool_assignment_settings: {
    key: 'poolAssignmentSettings',
    collect: { event: EVENT_SCOPED, tournament: TOURNAMENT_POOL_SETTINGS },
  },

  // Slot configs before their allowed-skill joins.
  event_slot_config_default: {
    key: 'eventSlotConfigDefault',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
    idMap: 'eventSlotConfig',
  },
  event_slot_config_default_skills: {
    key: 'eventSlotConfigDefaultSkills',
    collect: {
      event: { from: 'event_slot_config_default', local: 'slot_config_id' },
      tournament: 'omit',
    },
    fk: { slot_config_id: 'eventSlotConfig' },
    skillIdColumns: ['skill_id'],
  },
  referee_compensation_event_settings: {
    key: 'refereeCompensationEventSettings',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
    // plan_id (NOT NULL) references an org-level plan not copied across orgs
    crossOrg: 'drop',
  },
  event_venues: {
    key: 'eventVenues',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
    // venue belongs to the source org; a cross-org copy has no matching venue
    crossOrg: 'drop',
  },

  // ── Tournament and its structure ──────────────────────────────────────────
  tournaments: {
    key: 'tournaments',
    collect: { event: EVENT_SCOPED, tournament: ROOT },
    idMap: 'tournaments',
  },
  tournament_phase_venues: {
    key: 'tournamentPhaseVenues',
    collect: { event: BY_TOURNAMENT, tournament: BY_TOURNAMENT },
    crossOrg: { null: ['venue_id'] },
  },
  tournament_slot_config: {
    key: 'tournamentSlotConfig',
    collect: { event: BY_TOURNAMENT, tournament: BY_TOURNAMENT },
    idMap: 'tournamentSlotConfig',
  },
  tournament_slot_allowed_skills: {
    key: 'tournamentSlotAllowedSkills',
    collect: {
      event: { from: 'tournament_slot_config', local: 'slot_config_id' },
      tournament: { from: 'tournament_slot_config', local: 'slot_config_id' },
    },
    // slot_config_id is ambiguous across tables — here it is the TOURNAMENT
    // config, on event_slot_config_default_skills it is the event one.
    fk: { slot_config_id: 'tournamentSlotConfig' },
    skillIdColumns: ['skill_id'],
  },
  event_referee_tournaments: {
    key: 'eventRefereeTournaments',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
  },
  event_referee_days: {
    key: 'eventRefereeDays',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
  },
  registrations: {
    key: 'registrations',
    collect: { event: BY_TOURNAMENT, tournament: BY_TOURNAMENT },
    idMap: 'registrations',
  },

  phases: {
    key: 'phases',
    collect: { event: BY_TOURNAMENT, tournament: BY_TOURNAMENT },
    idMap: 'phases',
    // phases.service.ts stamps `config_json.bronzeSlotId`, which is a
    // bracket_slots.id inserted LATER. The id maps are all pre-seeded before
    // any row is rewritten precisely so this forward reference resolves.
    json: [{ path: 'config_json.bronzeSlotId', map: 'bracketSlots' }],
  },
  pools: { key: 'pools', collect: { event: BY_PHASE, tournament: BY_PHASE }, idMap: 'pools' },
  pool_members: {
    key: 'poolMembers',
    collect: {
      event: { from: 'pools', local: 'pool_id' },
      tournament: { from: 'pools', local: 'pool_id' },
    },
  },
  bracket_slots: {
    key: 'bracketSlots',
    collect: { event: BY_PHASE, tournament: BY_PHASE },
    idMap: 'bracketSlots',
  },
  swiss_entrants: { key: 'swissEntrants', collect: { event: BY_PHASE, tournament: BY_PHASE } },

  swiss_rounds: {
    key: 'swissRounds',
    collect: { event: BY_PHASE, tournament: BY_PHASE },
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
  matches: {
    key: 'matches',
    collect: {
      event: { from: 'phases', local: 'phase_id', include: 'scoring' },
      tournament: { from: 'phases', local: 'phase_id', include: 'scoring' },
    },
    idMap: 'matches',
  },
  referee_assignments: {
    key: 'refereeAssignments',
    collect: { event: EVENT_SCOPED, tournament: TOURNAMENT_REFEREE_ASSIGNMENTS },
    // role stores a referee_skills.id: system ids pass through, custom remap.
    skillIdColumns: ['role'],
  },
  match_events: {
    key: 'matchEvents',
    collect: { event: BY_MATCH_SCORING, tournament: BY_MATCH_SCORING },
  },
  exchanges: {
    key: 'exchanges',
    collect: { event: BY_MATCH_SCORING, tournament: BY_MATCH_SCORING },
    freshClientUuid: true,
    // A correction points at the exchange it replaced (0019). Never remapped,
    // so a restored copy's corrections referenced the SOURCE event's exchanges
    // — and the FK was satisfied, because those rows still exist, so nothing
    // complained. Same shape as the bye_registration_id miss.
    fk: { corrected_exchange_id: 'exchanges' },
    idMap: 'exchanges',
  },
  match_penalties: {
    key: 'matchPenalties',
    collect: { event: BY_MATCH_SCORING, tournament: BY_MATCH_SCORING },
    freshClientUuid: true,
    // ruleset_id / ruleset_entry_id point at org-level penalty rulesets that
    // aren't copied — they resolve on same-org restore, not across orgs.
    crossOrg: { null: ['ruleset_id', 'ruleset_entry_id'] },
    idMap: 'matchPenalties',
  },

  match_forfeits: {
    key: 'matchForfeits',
    collect: { event: BY_MATCH_SCORING, tournament: BY_MATCH_SCORING },
    fk: { parent_forfeit_id: 'matchForfeits' },
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
    collect: {
      event: { from: 'tournaments', local: 'tournament_id', include: 'scoring' },
      tournament: { from: 'tournaments', local: 'tournament_id', include: 'scoring' },
    },
    // penalties.service.ts `createSecondBlackCardReviewIfNeeded` stores the
    // match_penalties.ids that triggered the review. No FK is declared on them,
    // so nothing would ever have complained about a copy naming another event's
    // cards.
    json: [{ path: 'payload_json.penaltyIds[]', map: 'matchPenalties' }],
  },

  // ── Workshops and the programme ───────────────────────────────────────────
  // Tournaments and workshops both precede event_programme_blocks, which
  // references them by competition_id / workshop_id.
  workshops: {
    key: 'workshops',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
    // The workshop's DEFAULT venue (0090), which its sessions pre-fill from at
    // creation. Sessions nulled theirs across orgs and the parent never did, so
    // a cross-org copy kept pointing at the source org's venue — and every new
    // session created in that copy would have inherited it.
    crossOrg: { null: ['venue_id'] },
    idMap: 'workshops',
  },
  workshop_instructors: {
    key: 'workshopInstructors',
    collect: { event: { from: 'workshops', local: 'workshop_id' }, tournament: 'omit' },
  },
  workshop_sessions: {
    key: 'workshopSessions',
    collect: { event: { from: 'workshops', local: 'workshop_id' }, tournament: 'omit' },
    crossOrg: { null: ['venue_id', 'area_id'] },
    idMap: 'workshopSessions',
  },
  workshop_enrollments: {
    key: 'workshopEnrollments',
    collect: {
      event: { from: 'workshop_sessions', local: 'workshop_session_id' },
      tournament: 'omit',
    },
  },
  workshop_breaks: { key: 'workshopBreaks', collect: { event: EVENT_SCOPED, tournament: 'omit' } },
  event_programme_blocks: {
    key: 'eventProgrammeBlocks',
    collect: { event: EVENT_SCOPED, tournament: 'omit' },
  },
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

/**
 * How this table is gathered in the given scope, or 'omit' when a copy at that
 * scope does not carry it at all.
 */
export function collectRuleFor(
  table: ArchiveTableName,
  scope: 'event' | 'tournament',
): CollectRule | 'omit' {
  return ARCHIVE_TABLES[table]!.collect[scope];
}

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
