import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { escapeCsvCell, formatRoundCode, roundCodeShapeFromConfig } from '@myclash/types';
import { createStoredZip } from '../../common/stored-zip';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import type {
  ArchiveInclude,
  ArchiveOptions,
  ArchiveRow,
  ArchiveScope,
  ArchiveTables,
  MyClashArchive,
  RestoreOptions,
  RestorePreview,
  RestoreResult,
  TournamentArchiveReports,
} from './archive.types';

type QueryResult<T> = { data: T | null; error: { message: string } | null };
type QueryListResult = { data: ArchiveRow[] | null; error: { message: string } | null };
type QueryChain = PromiseLike<QueryListResult> & {
  select: (columns?: string, options?: Record<string, unknown>) => QueryChain;
  eq: (column: string, value: unknown) => QueryChain;
  in: (column: string, values: unknown[]) => QueryChain;
  order: (column: string, options?: Record<string, unknown>) => QueryChain;
  insert: (payload: ArchiveRow | ArchiveRow[]) => QueryChain;
  maybeSingle: () => Promise<QueryResult<ArchiveRow>>;
  single: () => Promise<QueryResult<ArchiveRow>>;
};
type DbClient = {
  from: (table: string) => QueryChain;
  rpc?: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};

// crossOrg = the restored copy lands in a different organization than the
// source. Org-level references (venues, penalty rulesets, compensation plans)
// aren't copied, so rows/columns that depend on them are dropped or nulled.
type RestoreTargets = {
  targetEventId?: string;
  targetTournamentId?: string;
  crossOrg?: boolean;
};

const EMPTY_TABLES: ArchiveTables = {
  events: [],
  themes: [],
  lices: [],
  persons: [],
  personPrivacy: [],
  refereeQualifications: [],
  poolAssignmentSettings: [],
  tournaments: [],
  registrations: [],
  phases: [],
  pools: [],
  poolMembers: [],
  bracketSlots: [],
  swissRounds: [],
  swissEntrants: [],
  matches: [],
  matchEvents: [],
  exchanges: [],
  refereeAssignments: [],
  workshops: [],
  workshopInstructors: [],
  workshopSessions: [],
  workshopEnrollments: [],
  workshopBreaks: [],
  eventProgrammeBlocks: [],
  refereeSkills: [],
  eventReferees: [],
  eventRefereeTournaments: [],
  eventRefereeDays: [],
  eventHiddenSkills: [],
  eventInstructors: [],
  eventSlotConfigDefault: [],
  eventSlotConfigDefaultSkills: [],
  tournamentSlotConfig: [],
  tournamentSlotAllowedSkills: [],
  tournamentPhaseVenues: [],
  eventVenues: [],
  refereeCompensationEventSettings: [],
  matchPenalties: [],
  matchForfeits: [],
  tournamentPenaltyReviews: [],
};

const TABLE_TO_ARCHIVE_KEY = {
  events: 'events',
  themes: 'themes',
  lices: 'lices',
  persons: 'persons',
  person_privacy: 'personPrivacy',
  referee_qualifications: 'refereeQualifications',
  pool_assignment_settings: 'poolAssignmentSettings',
  tournaments: 'tournaments',
  registrations: 'registrations',
  phases: 'phases',
  pools: 'pools',
  pool_members: 'poolMembers',
  bracket_slots: 'bracketSlots',
  swiss_rounds: 'swissRounds',
  swiss_entrants: 'swissEntrants',
  matches: 'matches',
  match_events: 'matchEvents',
  exchanges: 'exchanges',
  referee_assignments: 'refereeAssignments',
  workshops: 'workshops',
  workshop_instructors: 'workshopInstructors',
  workshop_sessions: 'workshopSessions',
  workshop_enrollments: 'workshopEnrollments',
  workshop_breaks: 'workshopBreaks',
  event_programme_blocks: 'eventProgrammeBlocks',
  referee_skills: 'refereeSkills',
  event_referees: 'eventReferees',
  event_referee_tournaments: 'eventRefereeTournaments',
  event_referee_days: 'eventRefereeDays',
  event_hidden_skills: 'eventHiddenSkills',
  event_instructors: 'eventInstructors',
  event_slot_config_default: 'eventSlotConfigDefault',
  event_slot_config_default_skills: 'eventSlotConfigDefaultSkills',
  tournament_slot_config: 'tournamentSlotConfig',
  tournament_slot_allowed_skills: 'tournamentSlotAllowedSkills',
  tournament_phase_venues: 'tournamentPhaseVenues',
  event_venues: 'eventVenues',
  referee_compensation_event_settings: 'refereeCompensationEventSettings',
  match_penalties: 'matchPenalties',
  match_forfeits: 'matchForfeits',
  tournament_penalty_reviews: 'tournamentPenaltyReviews',
} as const satisfies Record<string, keyof ArchiveTables>;

/** Which `IdMaps` member a nested id resolves through. */
type JsonIdMapName = 'matches' | 'registrations' | 'bracketSlots' | 'matchPenalties';

interface JsonIdPath {
  readonly path: string;
  readonly map: JsonIdMapName;
}

/**
 * Ids that live INSIDE a JSON column, per table.
 *
 * `remapRow`'s column sweep goes through `mapFk`, which returns early on
 * anything that is not a top-level string. So an id nested in an array or an
 * object survives a restore verbatim and keeps pointing into the SOURCE event —
 * a copy that is supposed to be self-contained silently is not. Same failure
 * shape as the `bye_registration_id` incident below, one level down.
 *
 * Path grammar, deliberately smaller than JSON Pointer: dotted keys, and `[]`
 * for "every element of this array". `a.b[]` is every element of the array at
 * `a.b`; `a[].b` is the `b` of every element of `a`. No wildcards and no
 * escapes — every path here is a literal shape some service writes, so a path
 * that stops matching must read as a mistake, not quietly match something else.
 *
 * Each entry was read off its writer, not guessed:
 *   match_forfeits  — match-forfeits.service.ts `matchSnapshot` / `loadRegistration`
 *   swiss_rounds    — swiss-pairing.service.ts `commitNextRound` (warnings/ranked)
 *                     and swiss-override.service.ts `recordAdjustment`, whose
 *                     entries come in TWO shapes: a `swap` carrying
 *                     a/bRegistrationId, and a `set-sides` carrying matchId plus
 *                     from/to side pairs. `byUserId` is deliberately absent —
 *                     it is an auth user, not an event-scoped row.
 *   phases          — phases.service.ts stamps `config_json.bronzeSlotId`
 *   tournament_penalty_reviews
 *                   — penalties.service.ts `createSecondBlackCardReviewIfNeeded`
 *                     stores the `match_penalties.id`s that triggered the review
 */
const JSON_ID_PATHS = {
  match_forfeits: [
    { path: 'downstream_match_ids[]', map: 'matches' },
    { path: 'previous_match_state.winner_registration_id', map: 'registrations' },
    // Same shape as its `previous_` sibling — both are `matchSnapshot` output,
    // so both carry the winner. 0186 added the post-state so a void can tell
    // whether the match still holds the result the record produced.
    { path: 'resulting_match_state.winner_registration_id', map: 'registrations' },
    { path: 'previous_registration_state.id', map: 'registrations' },
  ],
  swiss_rounds: [
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
  phases: [{ path: 'config_json.bronzeSlotId', map: 'bracketSlots' }],
  tournament_penalty_reviews: [{ path: 'payload_json.penaltyIds[]', map: 'matchPenalties' }],
} as const satisfies Partial<Record<keyof typeof TABLE_TO_ARCHIVE_KEY, readonly JsonIdPath[]>>;

/**
 * Rewrite every id reachable at `path` through `map`.
 *
 * A path that matches nothing is a no-op: an older archive simply has not got
 * the key, and a `set-sides` adjustment has no `aRegistrationId`. An id with no
 * entry in the map is left alone, matching `mapFk` — that is how a reference to
 * something outside the archive survives instead of becoming undefined.
 *
 * Kept out of `remapRow` so the switch stays a flat list of column statements.
 */
function remapJsonIdPath(row: ArchiveRow, path: string, map: Map<string, string>): void {
  const remap = (node: unknown, segments: string[]): unknown => {
    if (node === null || node === undefined) return node;

    if (segments.length === 0) {
      return typeof node === 'string' ? (map.get(node) ?? node) : node;
    }

    const [head, ...rest] = segments;
    if (head === '[]') {
      if (!Array.isArray(node)) return node;
      return node.map((element) => remap(element, rest));
    }
    if (typeof node !== 'object' || Array.isArray(node)) return node;

    const record = node as Record<string, unknown>;
    if (!(head! in record)) return node;
    return { ...record, [head!]: remap(record[head!], rest) };
  };

  // 'a.b[].c' → ['a', 'b', '[]', 'c']
  const segments = path
    .split('.')
    .flatMap((part) => (part.endsWith('[]') ? [part.slice(0, -2), '[]'] : [part]))
    .filter((part) => part.length > 0);

  const [column, ...rest] = segments;
  if (!column || !(column in row)) return;
  row[column] = remap(row[column], rest);
}

/**
 * Tables that carry an `event_id`/`tournament_id` (directly, or as a scoped
 * child) but are DELIBERATELY not part of an organizer archive. The
 * migration-scanning guard test asserts every scoped table is either in
 * TABLE_TO_ARCHIVE_KEY above or listed here, so a newly added scoped table
 * fails CI until someone consciously buckets it. Reasons, per group:
 *  - org-level catalogues shared across events (copied by reference, resolve
 *    on same-org restore): venues + rulesets + compensation plans, etc.
 *  - league data is cross-event and recomputed, not part of one event.
 *  - operational / derived / credential / notification / AI rows that must
 *    not clone into a restored copy.
 */
const ARCHIVE_EXCLUDED_TABLES = new Set<string>([
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

const ARCHIVE_COLLECTED_TABLES = new Set<string>(Object.keys(TABLE_TO_ARCHIVE_KEY));

export { ARCHIVE_EXCLUDED_TABLES, ARCHIVE_COLLECTED_TABLES, JSON_ID_PATHS };

// Parents before children — FK-dependency order. New scoped tables are
// interleaved so their referenced rows are always inserted first. Notably:
// referee_skills before anything that stores a skill id (event_hidden_skills,
// the slot-config skill joins, referee_assignments.role); event_referees before
// its per-tournament/day allowlists; slot configs before their skill joins;
// tournaments/workshops before event_programme_blocks (competition_id/workshop_id).
const INSERT_ORDER: Array<keyof typeof TABLE_TO_ARCHIVE_KEY> = [
  'events',
  'themes',
  'lices',
  'persons',
  'person_privacy',
  'referee_skills',
  'referee_qualifications',
  'event_referees',
  'event_hidden_skills',
  'event_instructors',
  'pool_assignment_settings',
  'event_slot_config_default',
  'event_slot_config_default_skills',
  'referee_compensation_event_settings',
  'event_venues',
  'tournaments',
  'tournament_phase_venues',
  'tournament_slot_config',
  'tournament_slot_allowed_skills',
  'event_referee_tournaments',
  'event_referee_days',
  'registrations',
  'phases',
  'pools',
  'pool_members',
  'bracket_slots',
  'swiss_entrants',
  // Before `matches`: a match carries swiss_round_id, so the round it points at
  // has to exist first or the FK remaps to null and the round loses its bouts.
  'swiss_rounds',
  'matches',
  'referee_assignments',
  'match_events',
  'exchanges',
  'match_penalties',
  'match_forfeits',
  'tournament_penalty_reviews',
  'workshops',
  'workshop_instructors',
  'workshop_sessions',
  'workshop_enrollments',
  'workshop_breaks',
  'event_programme_blocks',
];
const RESTORE_CONFIRMATION = 'RESTORE MYCLASH ARCHIVE';

@Injectable()
export class ArchiveService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  async assertEventAdmin(eventId: string, userId: string): Promise<ArchiveRow> {
    const event = await this.getRequiredRow('events', eventId, 'Event');
    await this.orgs.assertOrgRole(event['organization_id'] as string, userId, 'admin');
    return event;
  }

  async assertTournamentAdmin(
    tournamentId: string,
    userId: string,
  ): Promise<{ event: ArchiveRow; tournament: ArchiveRow }> {
    const tournament = await this.getRequiredRow('tournaments', tournamentId, 'Tournament');
    const event = await this.assertEventAdmin(tournament['event_id'] as string, userId);
    return { event, tournament };
  }

  async generateEventArchive(
    eventId: string,
    userId: string,
    options: ArchiveOptions,
  ): Promise<MyClashArchive> {
    const event = await this.assertEventAdmin(eventId, userId);
    const tables = await this.collectEventTables(event, options.include);
    return this.buildArchive('event', event, null, tables, options.include);
  }

  async generateTournamentArchive(
    tournamentId: string,
    userId: string,
    options: ArchiveOptions,
  ): Promise<MyClashArchive> {
    const { event, tournament } = await this.assertTournamentAdmin(tournamentId, userId);
    const tables = await this.collectTournamentTables(event, tournament, options.include);
    return this.buildArchive('tournament', event, tournament, tables, options.include);
  }

  async generateTournamentCsvReports(
    tournamentId: string,
    userId: string,
  ): Promise<TournamentArchiveReports> {
    const archive = await this.generateTournamentArchive(tournamentId, userId, {
      include: 'scoring',
    });
    return (
      archive.reports.tournaments[0] ?? {
        tournamentId,
        tournamentName: tournamentId,
        matchesCsv: this.buildMatchesCsv([]),
        exchangesCsv: this.buildExchangesCsv([]),
        resultsCsv: this.buildResultsReportCsv([], [], []),
        rankingsCsv: this.buildRankingsCsv([], [], []),
      }
    );
  }

  async previewRestore(buffer: Buffer, _userId: string): Promise<RestorePreview> {
    const archive = this.parseArchive(buffer);
    const counts = this.countArchiveRows(archive);
    const warnings: string[] = [];
    const sourceStatus =
      archive.scope === 'tournament' ? archive.source.tournamentStatus : archive.source.eventStatus;
    if (sourceStatus === 'running') {
      warnings.push('Archives captured from running events or tournaments cannot be restored.');
    }

    return {
      manifest: archive.manifest,
      version: archive.version,
      scope: archive.scope,
      include: archive.include,
      source: archive.source,
      counts,
      warnings,
      canRestore: warnings.length === 0,
    };
  }

  async restoreArchiveCopy(
    buffer: Buffer,
    userId: string,
    options: RestoreOptions,
  ): Promise<RestoreResult> {
    if (options.confirmation !== RESTORE_CONFIRMATION) {
      throw new BadRequestException(
        `Restore confirmation must exactly match: ${RESTORE_CONFIRMATION}`,
      );
    }
    const archive = this.parseArchive(buffer);
    const sourceStatus =
      archive.scope === 'tournament' ? archive.source.tournamentStatus : archive.source.eventStatus;
    if (sourceStatus === 'running') {
      throw new ConflictException(
        'Cannot restore an archive captured while the source was running.',
      );
    }

    if (archive.scope === 'event') {
      return this.restoreEventCopy(archive, userId, options);
    }
    return this.restoreTournamentCopy(archive, userId, options);
  }

  archiveToJsonBuffer(archive: MyClashArchive): Buffer {
    return Buffer.from(JSON.stringify(archive, null, 2), 'utf8');
  }

  archiveToZipBuffer(archive: MyClashArchive): Buffer {
    const files: Record<string, string> = {
      'manifest.json': JSON.stringify(archive, null, 2),
    };
    for (const report of archive.reports.tournaments) {
      const prefix = `reports/${this.safeFilename(report.tournamentName)}`;
      files[`${prefix}/matches.csv`] = report.matchesCsv;
      files[`${prefix}/exchanges.csv`] = report.exchangesCsv;
      files[`${prefix}/results.csv`] = report.resultsCsv;
      files[`${prefix}/rankings.csv`] = report.rankingsCsv;
    }
    return createStoredZip(files);
  }

  private async restoreEventCopy(
    archive: MyClashArchive,
    userId: string,
    options: RestoreOptions,
  ): Promise<RestoreResult> {
    const targetOrganizationId =
      options.targetOrganizationId ??
      (archive.data.events[0]?.['organization_id'] as string | undefined);
    if (!targetOrganizationId) {
      throw new BadRequestException('targetOrganizationId is required for event restore.');
    }
    await this.orgs.assertOrgRole(targetOrganizationId, userId, 'admin');

    const maps = createIdMaps();
    const sourceEvent = archive.data.events[0];
    if (!sourceEvent) throw new BadRequestException('Archive does not contain an event.');

    const restoredEventId = randomUUID();
    maps.events.set(sourceEvent['id'] as string, restoredEventId);
    // Self-map, and NOT redundant: the row below is rewritten to carry
    // `restoredEventId`, and `insertMappedTables` pre-seeds each table's id map
    // with a fresh UUID for any row id it has not seen as a KEY. Without this
    // the event would be inserted under a third id while its children still
    // pointed at `restoredEventId`. See `restoreTournamentCopy` for the same.
    maps.events.set(restoredEventId, restoredEventId);
    const restoredSlug = await this.uniqueEventSlug(
      targetOrganizationId,
      `${sourceEvent['slug'] as string}-restored-${restoredEventId.slice(0, 8)}`,
    );

    const data = normalizeArchiveTables(archive.data);
    data.events = [
      this.cleanRow({
        ...sourceEvent,
        id: restoredEventId,
        organization_id: targetOrganizationId,
        slug: restoredSlug,
        name: `${sourceEvent['name'] as string} (restored)`,
        status: 'draft',
        created_at: undefined,
        updated_at: undefined,
      }),
    ];

    const crossOrg =
      (sourceEvent['organization_id'] as string | undefined) !== targetOrganizationId;
    await this.insertMappedTables(data, maps, { targetEventId: restoredEventId, crossOrg });
    await this.auditRestore(userId, 'event', sourceEvent['id'] as string, restoredEventId);
    // Fighter exchange stats are computed on-read (fighter_exchange_stats, 0128) —
    // restored rows are reflected immediately, no derived-data refresh needed.

    return {
      scope: 'event',
      restoredEventId,
      restoredSlug,
      counts: this.countArchiveRows(archive),
    };
  }

  private async restoreTournamentCopy(
    archive: MyClashArchive,
    userId: string,
    options: RestoreOptions,
  ): Promise<RestoreResult> {
    if (!options.targetEventId) {
      throw new BadRequestException('targetEventId is required for tournament restore.');
    }
    const targetEvent = await this.assertEventAdmin(options.targetEventId, userId);
    if (targetEvent['status'] === 'running') {
      throw new ConflictException('Cannot restore into a running event.');
    }

    const data = normalizeArchiveTables(archive.data);
    const sourceTournament = data.tournaments[0];
    if (!sourceTournament) throw new BadRequestException('Archive does not contain a tournament.');

    const maps = createIdMaps();
    const restoredTournamentId = randomUUID();
    maps.tournaments.set(sourceTournament['id'] as string, restoredTournamentId);
    // The self-map `restoreEventCopy` has, and this path was missing: the row is
    // rewritten to carry `restoredTournamentId`, so without a KEY for that id
    // `insertMappedTables` pre-seeds it to a fresh UUID and inserts the
    // tournament under a THIRD id — while every registration, phase and match
    // still points at `restoredTournamentId`. Each child insert then violated
    // its foreign key, so a tournament restore 400d every time.
    maps.tournaments.set(restoredTournamentId, restoredTournamentId);
    maps.events.set(archive.source.eventId, options.targetEventId);
    const restoredSlug = await this.uniqueTournamentSlug(
      options.targetEventId,
      `${sourceTournament['slug'] as string}-restored-${restoredTournamentId.slice(0, 8)}`,
    );

    data.events = [];
    data.themes = [];
    data.lices = [];
    if (options.targetEventId === archive.source.eventId) {
      for (const person of data.persons) {
        maps.persons.set(person['id'] as string, person['id'] as string);
      }
      data.persons = [];
      data.personPrivacy = [];
    }
    data.tournaments = [
      this.cleanRow({
        ...sourceTournament,
        id: restoredTournamentId,
        event_id: options.targetEventId,
        slug: restoredSlug,
        name: `${sourceTournament['name'] as string} (restored)`,
        status: 'draft',
        created_at: undefined,
        updated_at: undefined,
      }),
    ];

    const sourceOrgId = archive.data.events?.[0]?.['organization_id'] as string | undefined;
    const crossOrg =
      sourceOrgId !== undefined &&
      sourceOrgId !== (targetEvent['organization_id'] as string | undefined);
    await this.insertMappedTables(data, maps, {
      targetEventId: options.targetEventId,
      targetTournamentId: restoredTournamentId,
      crossOrg,
    });
    await this.auditRestore(
      userId,
      'tournament',
      sourceTournament['id'] as string,
      restoredTournamentId,
    );
    // On-read fighter exchange stats (0128) — no derived-data refresh needed.

    return {
      scope: 'tournament',
      restoredTournamentId,
      restoredSlug,
      counts: this.countArchiveRows(archive),
    };
  }

  private async insertMappedTables(data: ArchiveTables, maps: IdMaps, targets: RestoreTargets) {
    // EVERY id map complete before ANY row is remapped.
    //
    // The pre-seed used to run per-table inside the insert loop below, which
    // made a table's ids resolvable only from its own pass onward — fine for an
    // intra-table self-reference like `match_forfeits.parent_forfeit_id`, but it
    // left every FORWARD reference unresolvable. `phases.config_json.bronzeSlotId`
    // holds a `bracket_slots.id`, and bracket_slots is inserted after phases, so
    // it could not be remapped at all and the restored phase pointed at the
    // SOURCE event's slot.
    //
    // Hoisting is free: pre-seeding only mints ids, it inserts nothing. The
    // `!map.has` guard is what keeps it non-destructive — `restoreTournamentCopy`
    // pre-points `maps.tournaments` at the target before calling in, and that
    // must survive.
    for (const table of INSERT_ORDER) {
      const rows = data[TABLE_TO_ARCHIVE_KEY[table]];
      if (rows.length === 0) continue;
      const map = idMapForTable(table, maps);
      for (const row of rows) {
        const rowId = row['id'];
        if (typeof rowId === 'string' && !map.has(rowId)) map.set(rowId, randomUUID());
      }
    }

    for (const table of INSERT_ORDER) {
      const key = TABLE_TO_ARCHIVE_KEY[table];
      const rows = data[key];
      if (rows.length === 0) continue;
      const mapped = rows
        .map((row) => this.remapRow(table, row, maps, targets))
        .filter((row): row is ArchiveRow => row !== null);
      if (mapped.length === 0) continue;
      await this.insertRows(table, mapped);
    }
  }

  private remapRow(
    table: keyof typeof TABLE_TO_ARCHIVE_KEY,
    row: ArchiveRow,
    maps: IdMaps,
    targets: RestoreTargets,
  ): ArchiveRow | null {
    const next = { ...row };
    const id = next['id'];
    if (typeof id === 'string') {
      const map = idMapForTable(table, maps);
      if (!map.has(id)) map.set(id, randomUUID());
      next['id'] = map.get(id);
    }
    const crossOrg = targets.crossOrg === true;

    this.mapFk(next, 'event_id', maps.events, targets.targetEventId);
    this.mapFk(next, 'lice_id', maps.lices);
    this.mapFk(next, 'person_id', maps.persons);
    // `matches.referee_id` is an EVENT-SCOPED persons.id (migration 0039), not a
    // global person — so it has to be remapped like any other person reference.
    // Left unmapped, a restored match pointed at the SOURCE event's person row:
    // delete the source and `ON DELETE SET NULL` silently dropped the referee,
    // keep it and the referee dashboard listed the copy's match under the wrong
    // event's person (assignments.service.ts reads this column directly).
    this.mapFk(next, 'referee_id', maps.persons);
    this.mapFk(next, 'global_person_id', maps.fighters);
    this.mapFk(next, 'tournament_id', maps.tournaments, targets.targetTournamentId);
    this.mapFk(next, 'competition_id', maps.tournaments);
    this.mapFk(next, 'registration_id', maps.registrations);
    this.mapFk(next, 'red_registration_id', maps.registrations);
    this.mapFk(next, 'blue_registration_id', maps.registrations);
    this.mapFk(next, 'winner_registration_id', maps.registrations);
    this.mapFk(next, 'forfeiting_registration_id', maps.registrations);
    this.mapFk(next, 'replacement_registration_id', maps.registrations);
    this.mapFk(next, 'registration_a_id', maps.registrations);
    this.mapFk(next, 'registration_b_id', maps.registrations);
    // `swiss_rounds.bye_registration_id`. Missed when the Swiss tables were
    // registered, and silently: the FK points at `registrations(id)` and the
    // SOURCE row still exists, so the constraint is satisfied and the restore
    // succeeds with the copy's byes pointing into another event. The bye holder
    // then renders blank everywhere — and their bye points vanish from the
    // restored standings, because `swissRecords` credits `points.bye` by
    // matching this id against the phase's own entrants.
    this.mapFk(next, 'bye_registration_id', maps.registrations);
    this.mapFk(next, 'phase_id', maps.phases);
    this.mapFk(next, 'pool_id', maps.pools);
    this.mapFk(next, 'bracket_slot_id', maps.bracketSlots);
    this.mapFk(next, 'swiss_round_id', maps.swissRounds);
    this.mapFk(next, 'match_id', maps.matches);
    this.mapFk(next, 'workshop_id', maps.workshops);
    this.mapFk(next, 'workshop_session_id', maps.workshopSessions);

    switch (table) {
      case 'persons':
        next['claim_status'] = 'unclaimed';
        next['claimed_by_user_id'] = null;
        break;
      case 'exchanges':
        next['client_uuid'] = randomUUID();
        // A correction points at the exchange it replaced (0019). Never
        // remapped, so a restored copy's corrections referenced the SOURCE
        // event's exchanges — and the FK was satisfied, because those rows
        // still exist, so nothing complained. Same shape as the
        // `bye_registration_id` miss documented above.
        this.mapFk(next, 'corrected_exchange_id', idMapForTable('exchanges', maps));
        break;
      case 'match_penalties':
        next['client_uuid'] = randomUUID();
        // ruleset_id / ruleset_entry_id point at org-level penalty rulesets that
        // aren't copied — they resolve on same-org restore, not across orgs.
        if (crossOrg) {
          next['ruleset_id'] = null;
          next['ruleset_entry_id'] = null;
        }
        break;
      case 'match_forfeits':
        this.mapFk(next, 'parent_forfeit_id', maps.matchForfeits);
        break;
      case 'event_hidden_skills':
        next['skill_id'] = this.remapSkillId(next['skill_id'], maps);
        break;
      case 'referee_assignments':
        // role stores a referee_skills.id: system ids pass through, custom remap.
        next['role'] = this.remapSkillId(next['role'], maps);
        break;
      case 'tournament_slot_allowed_skills':
        this.mapFk(next, 'slot_config_id', maps.tournamentSlotConfig);
        next['skill_id'] = this.remapSkillId(next['skill_id'], maps);
        break;
      case 'event_slot_config_default_skills':
        this.mapFk(next, 'slot_config_id', maps.eventSlotConfig);
        next['skill_id'] = this.remapSkillId(next['skill_id'], maps);
        break;
      case 'lices':
        if (crossOrg) next['venue_id'] = null;
        break;
      case 'workshop_sessions':
        if (crossOrg) {
          next['venue_id'] = null;
          next['area_id'] = null;
        }
        break;
      case 'event_venues':
        // venue belongs to the source org; a cross-org copy has no matching venue
        if (crossOrg) return null;
        break;
      case 'tournament_phase_venues':
        if (crossOrg) next['venue_id'] = null;
        break;
      case 'referee_compensation_event_settings':
        // plan_id (NOT NULL) references an org-level plan not copied across orgs
        if (crossOrg) return null;
        break;
      default:
        break;
    }
    // Ids the column sweep above cannot see, because they are not top-level
    // strings. Declared per table in JSON_ID_PATHS.
    for (const { path, map } of jsonIdPathsFor(table)) {
      remapJsonIdPath(next, path, jsonIdMap(map, maps));
    }

    return this.cleanRow(next);
  }

  private remapSkillId(value: unknown, maps: IdMaps): unknown {
    if (typeof value !== 'string') return value;
    return maps.refereeSkills.get(value) ?? value;
  }

  private mapFk(row: ArchiveRow, column: string, map: Map<string, string>, fallback?: string) {
    const value = row[column];
    if (typeof value !== 'string') return;
    row[column] = map.get(value) ?? fallback ?? value;
  }

  private async collectEventTables(
    event: ArchiveRow,
    include: ArchiveInclude,
  ): Promise<ArchiveTables> {
    const eventId = event['id'] as string;
    const tables = normalizeArchiveTables({ events: [event], tournaments: [] });
    tables.themes = await this.listRows('themes', 'event_id', eventId);
    tables.lices = await this.listRows('lices', 'event_id', eventId);
    tables.persons = await this.listRows('persons', 'event_id', eventId);
    tables.personPrivacy = await this.listRowsByIds(
      'person_privacy',
      'person_id',
      ids(tables.persons),
    );
    tables.refereeQualifications = await this.listRows(
      'referee_qualifications',
      'event_id',
      eventId,
    );
    tables.poolAssignmentSettings = await this.listRows(
      'pool_assignment_settings',
      'event_id',
      eventId,
    );
    tables.tournaments = await this.listRows('tournaments', 'event_id', eventId);
    await this.collectTournamentChildren(tables, ids(tables.tournaments), include);
    tables.refereeAssignments = await this.listRows('referee_assignments', 'event_id', eventId);
    tables.workshops = await this.listRows('workshops', 'event_id', eventId);
    tables.workshopInstructors = await this.listRowsByIds(
      'workshop_instructors',
      'workshop_id',
      ids(tables.workshops),
    );
    tables.workshopSessions = await this.listRowsByIds(
      'workshop_sessions',
      'workshop_id',
      ids(tables.workshops),
    );
    tables.workshopEnrollments = await this.listRowsByIds(
      'workshop_enrollments',
      'workshop_session_id',
      ids(tables.workshopSessions),
    );
    // Referee roster, custom skills, granular availability, per-event skill
    // visibility, and the event instructor roster (all event-scoped).
    tables.refereeSkills = await this.listRows('referee_skills', 'event_id', eventId);
    tables.eventReferees = await this.listRows('event_referees', 'event_id', eventId);
    tables.eventRefereeTournaments = await this.listRows(
      'event_referee_tournaments',
      'event_id',
      eventId,
    );
    tables.eventRefereeDays = await this.listRows('event_referee_days', 'event_id', eventId);
    tables.eventHiddenSkills = await this.listRows('event_hidden_skills', 'event_id', eventId);
    tables.eventInstructors = await this.listRows('event_instructors', 'event_id', eventId);
    // Event-level staffing slot defaults + their allowed-skill joins.
    tables.eventSlotConfigDefault = await this.listRows(
      'event_slot_config_default',
      'event_id',
      eventId,
    );
    tables.eventSlotConfigDefaultSkills = await this.listRowsByIds(
      'event_slot_config_default_skills',
      'slot_config_id',
      ids(tables.eventSlotConfigDefault),
    );
    // Schedule programme, workshop breaks, venue links, compensation choice.
    tables.eventProgrammeBlocks = await this.listRows(
      'event_programme_blocks',
      'event_id',
      eventId,
    );
    tables.workshopBreaks = await this.listRows('workshop_breaks', 'event_id', eventId);
    tables.eventVenues = await this.listRows('event_venues', 'event_id', eventId);
    tables.refereeCompensationEventSettings = await this.listRows(
      'referee_compensation_event_settings',
      'event_id',
      eventId,
    );
    return tables;
  }

  private async collectTournamentTables(
    event: ArchiveRow,
    tournament: ArchiveRow,
    include: ArchiveInclude,
  ): Promise<ArchiveTables> {
    const tables = normalizeArchiveTables({ events: [event], tournaments: [tournament] });
    await this.collectTournamentChildren(tables, [tournament['id'] as string], include);
    const personIds = idsByColumn(tables.registrations, 'person_id');
    tables.persons = await this.listRowsByIds('persons', 'id', personIds);
    tables.personPrivacy = await this.listRowsByIds('person_privacy', 'person_id', personIds);
    tables.lices = await this.listRows('lices', 'event_id', event['id'] as string);
    tables.poolAssignmentSettings = (
      await this.listRows('pool_assignment_settings', 'event_id', event['id'] as string)
    ).filter((row) => !row['tournament_id'] || row['tournament_id'] === tournament['id']);
    const poolIds = ids(tables.pools);
    const matchIds = ids(tables.matches);
    tables.refereeAssignments = (
      await this.listRows('referee_assignments', 'event_id', event['id'] as string)
    ).filter(
      (row) =>
        (typeof row['pool_id'] === 'string' && poolIds.includes(row['pool_id'])) ||
        (typeof row['match_id'] === 'string' && matchIds.includes(row['match_id'])),
    );
    return tables;
  }

  private async collectTournamentChildren(
    tables: ArchiveTables,
    tournamentIds: string[],
    include: ArchiveInclude,
  ) {
    if (tournamentIds.length === 0) return;
    tables.registrations = await this.listRowsByIds(
      'registrations',
      'tournament_id',
      tournamentIds,
    );
    tables.phases = await this.listRowsByIds('phases', 'tournament_id', tournamentIds);
    tables.pools = await this.listRowsByIds('pools', 'phase_id', ids(tables.phases));
    tables.poolMembers = await this.listRowsByIds('pool_members', 'pool_id', ids(tables.pools));
    tables.bracketSlots = await this.listRowsByIds('bracket_slots', 'phase_id', ids(tables.phases));
    // Swiss rounds and its roster. Phase-scoped like pools and bracket slots,
    // which is why the migration-coverage guard cannot see them on its own —
    // it keys on event_id/tournament_id. See the note on that test.
    tables.swissRounds = await this.listRowsByIds('swiss_rounds', 'phase_id', ids(tables.phases));
    tables.swissEntrants = await this.listRowsByIds(
      'swiss_entrants',
      'phase_id',
      ids(tables.phases),
    );
    // Tournament-level staffing slot config + per-phase venue intent (structure,
    // always captured regardless of include level).
    tables.tournamentSlotConfig = await this.listRowsByIds(
      'tournament_slot_config',
      'tournament_id',
      tournamentIds,
    );
    tables.tournamentSlotAllowedSkills = await this.listRowsByIds(
      'tournament_slot_allowed_skills',
      'slot_config_id',
      ids(tables.tournamentSlotConfig),
    );
    tables.tournamentPhaseVenues = await this.listRowsByIds(
      'tournament_phase_venues',
      'tournament_id',
      tournamentIds,
    );
    if (include === 'scoring') {
      const phaseIds = ids(tables.phases);
      tables.matches = await this.listRowsByIds('matches', 'phase_id', phaseIds);
      tables.matchEvents = await this.listRowsByIds(
        'match_events',
        'match_id',
        ids(tables.matches),
      );
      tables.exchanges = await this.listRowsByIds('exchanges', 'match_id', ids(tables.matches));
      // Penalty cards, forfeits, and second-black-card reviews are scoring data.
      tables.matchPenalties = await this.listRowsByIds(
        'match_penalties',
        'match_id',
        ids(tables.matches),
      );
      tables.matchForfeits = await this.listRowsByIds(
        'match_forfeits',
        'match_id',
        ids(tables.matches),
      );
      tables.tournamentPenaltyReviews = await this.listRowsByIds(
        'tournament_penalty_reviews',
        'tournament_id',
        tournamentIds,
      );
    }
  }

  private buildArchive(
    scope: ArchiveScope,
    event: ArchiveRow,
    tournament: ArchiveRow | null,
    tables: ArchiveTables,
    include: ArchiveInclude,
  ): MyClashArchive {
    return {
      manifest: 'myclash.archive.v1',
      version: 1,
      generatedAt: new Date().toISOString(),
      scope,
      include,
      source: {
        eventId: event['id'] as string,
        eventSlug: event['slug'] as string,
        eventName: event['name'] as string,
        eventStatus: event['status'] as string,
        ...(tournament
          ? {
              tournamentId: tournament['id'] as string,
              tournamentSlug: tournament['slug'] as string,
              tournamentName: tournament['name'] as string,
              tournamentStatus: tournament['status'] as string,
            }
          : {}),
      },
      data: tables,
      reports: {
        tournaments:
          include === 'scoring'
            ? tables.tournaments.map((row) => this.reportForTournament(row, tables))
            : [],
      },
    };
  }

  private reportForTournament(
    tournament: ArchiveRow,
    tables: ArchiveTables,
  ): TournamentArchiveReports {
    const tournamentId = tournament['id'] as string;
    const registrations = tables.registrations.filter(
      (row) => row['tournament_id'] === tournamentId,
    );
    const phaseIds = ids(tables.phases.filter((row) => row['tournament_id'] === tournamentId));
    const matches = tables.matches.filter(
      (row) =>
        row['tournament_id'] === tournamentId || phaseIds.includes(row['phase_id'] as string),
    );
    const matchIds = ids(matches);
    const exchanges = tables.exchanges.filter((row) =>
      matchIds.includes(row['match_id'] as string),
    );

    // Pre-compute a matchId → roundCode map once per tournament. The pool
    // sort_order + bracket round + tournament weapon/size all come from
    // sibling tables in the same archive snapshot, so this stays consistent
    // with the data being exported even if the live DB drifts later.
    const roundCodes = this.computeRoundCodes(tournament, matches, tables);

    return {
      tournamentId,
      tournamentName: tournament['name'] as string,
      matchesCsv: this.buildMatchesCsv(matches, roundCodes),
      exchangesCsv: this.buildExchangesCsv(exchanges),
      resultsCsv: this.buildResultsReportCsv(matches, registrations, tables.persons, roundCodes),
      rankingsCsv: this.buildRankingsCsv(matches, registrations, tables.persons),
    };
  }

  private computeRoundCodes(
    tournament: ArchiveRow,
    matches: ArchiveRow[],
    tables: ArchiveTables,
  ): Map<string, string> {
    const weapon = (tournament['weapon'] as string | null | undefined) ?? null;
    const poolSortOrder = new Map<string, number>();
    for (const pool of tables.pools) {
      if (typeof pool['sort_order'] === 'number') {
        poolSortOrder.set(pool['id'] as string, pool['sort_order'] as number);
      }
    }
    const slotRound = new Map<string, number>();
    for (const slot of tables.bracketSlots) {
      if (typeof slot['round'] === 'number') {
        slotRound.set(slot['id'] as string, slot['round'] as number);
      }
    }
    const swissRoundNumber = new Map<string, number>();
    for (const round of tables.swissRounds) {
      if (typeof round['round_number'] === 'number') {
        swissRoundNumber.set(round['id'] as string, round['round_number'] as number);
      }
    }
    // bracketSize lives on phases.config_json (bracketSize, or
    // mainBracketSize for double-elim); no tournaments.bracket_size
    // column exists at the SQL level. The WB/LB split comes from the same
    // blob and must travel with it — without it an archived double-elim
    // bracket exports single-elim round codes, labelling the winners final,
    // the grand final and the reset all as "F".
    const bracketSizeByPhaseId = new Map<string, number | null>();
    const roundShapeByPhaseId = new Map<string, ReturnType<typeof roundCodeShapeFromConfig>>();
    for (const phase of tables.phases) {
      const phaseType = (phase['type'] as string | null | undefined) ?? null;
      if (phaseType === 'pool') continue;
      const cfg = (phase['config_json'] as Record<string, unknown> | null | undefined) ?? null;
      const size = (cfg?.['bracketSize'] ?? cfg?.['mainBracketSize']) as number | undefined;
      bracketSizeByPhaseId.set(phase['id'] as string, typeof size === 'number' ? size : null);
      roundShapeByPhaseId.set(phase['id'] as string, roundCodeShapeFromConfig(cfg));
    }

    const out = new Map<string, string>();
    for (const match of matches) {
      const poolId = match['pool_id'] as string | null;
      const bracketSlotId = match['bracket_slot_id'] as string | null;
      const swissRoundId = match['swiss_round_id'] as string | null;
      const phaseId = match['phase_id'] as string | null;
      const poolNumber =
        poolId !== null && poolSortOrder.has(poolId)
          ? (poolSortOrder.get(poolId) as number) + 1
          : null;
      const bracketRound =
        bracketSlotId !== null && slotRound.has(bracketSlotId)
          ? (slotRound.get(bracketSlotId) as number)
          : null;
      const bracketSize = phaseId !== null ? (bracketSizeByPhaseId.get(phaseId) ?? null) : null;
      out.set(
        match['id'] as string,
        formatRoundCode({
          weapon,
          poolNumber,
          bracketRound,
          bracketSize,
          swissRound: swissRoundId !== null ? (swissRoundNumber.get(swissRoundId) ?? null) : null,
          matchNumber: (match['match_number_label'] as string | null) ?? null,
          ...(phaseId !== null ? (roundShapeByPhaseId.get(phaseId) ?? {}) : {}),
        }),
      );
    }
    return out;
  }

  private buildMatchesCsv(matches: ArchiveRow[], roundCodes?: Map<string, string>): string {
    const lines = [
      'match_id,round_code,match_label,status,red_registration_id,blue_registration_id,red_score,blue_score,winner_registration_id',
    ];
    for (const match of matches) {
      const code = roundCodes?.get(match['id'] as string) ?? '';
      lines.push(
        [
          match['id'],
          this.csvEscape(code),
          this.csvEscape(String(match['match_number_label'] ?? '')),
          match['status'] ?? '',
          match['red_registration_id'] ?? '',
          match['blue_registration_id'] ?? '',
          match['red_score'] ?? '',
          match['blue_score'] ?? '',
          match['winner_registration_id'] ?? '',
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  private buildExchangesCsv(exchanges: ArchiveRow[]): string {
    const lines = [
      'exchange_id,match_id,sequence,type,first_striker,first_strike_value,afterblow_value,voided',
    ];
    for (const exchange of exchanges) {
      lines.push(
        [
          exchange['id'],
          exchange['match_id'],
          exchange['sequence'] ?? '',
          exchange['type'] ?? '',
          exchange['first_striker_color'] ?? '',
          exchange['first_strike_value'] ?? '',
          exchange['afterblow_value'] ?? '',
          exchange['voided'] ? 'true' : 'false',
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  private buildResultsReportCsv(
    matches: ArchiveRow[],
    registrations: ArchiveRow[],
    persons: ArchiveRow[],
    roundCodes?: Map<string, string>,
  ): string {
    // Human-readable report an organiser opens in Excel, so the columns are
    // named for the SIDES, not for a colour. `red`/`blue` here held fighter
    // NAMES, and read as a lie for any tournament not run red-vs-blue. The
    // machine-readable archive CSVs keep their DB column names — those
    // round-trip on re-import.
    const lines = ['round_code,match_label,fighter_1,fighter_2,score_1,score_2,winner'];
    for (const match of matches) {
      const red = this.registrationName(match['red_registration_id'], registrations, persons);
      const blue = this.registrationName(match['blue_registration_id'], registrations, persons);
      const winner = this.registrationName(match['winner_registration_id'], registrations, persons);
      const code = roundCodes?.get(match['id'] as string) ?? '';
      lines.push(
        [
          this.csvEscape(code),
          this.csvEscape(String(match['match_number_label'] ?? '')),
          this.csvEscape(red),
          this.csvEscape(blue),
          match['red_score'] ?? '',
          match['blue_score'] ?? '',
          this.csvEscape(winner),
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  private buildRankingsCsv(
    matches: ArchiveRow[],
    registrations: ArchiveRow[],
    persons: ArchiveRow[],
  ): string {
    const points = new Map<string, { wins: number; pointsFor: number; pointsAgainst: number }>();
    for (const registration of registrations) {
      points.set(registration['id'] as string, { wins: 0, pointsFor: 0, pointsAgainst: 0 });
    }
    for (const match of matches.filter((row) => row['status'] === 'completed')) {
      const redId = match['red_registration_id'] as string | undefined;
      const blueId = match['blue_registration_id'] as string | undefined;
      if (!redId || !blueId) continue;
      const red = points.get(redId);
      const blue = points.get(blueId);
      if (!red || !blue) continue;
      const redScore = Number(match['red_score'] ?? 0);
      const blueScore = Number(match['blue_score'] ?? 0);
      red.pointsFor += redScore;
      red.pointsAgainst += blueScore;
      blue.pointsFor += blueScore;
      blue.pointsAgainst += redScore;
      if (match['winner_registration_id'] === redId) red.wins += 1;
      if (match['winner_registration_id'] === blueId) blue.wins += 1;
    }
    const ranked = [...registrations].sort((a, b) => {
      const left = points.get(a['id'] as string) ?? { wins: 0, pointsFor: 0, pointsAgainst: 0 };
      const right = points.get(b['id'] as string) ?? { wins: 0, pointsFor: 0, pointsAgainst: 0 };
      return (
        right.wins - left.wins ||
        right.pointsFor - left.pointsFor ||
        left.pointsAgainst - right.pointsAgainst
      );
    });
    const lines = ['rank,name,wins,points_for,points_against'];
    ranked.forEach((registration, index) => {
      const score = points.get(registration['id'] as string) ?? {
        wins: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
      lines.push(
        [
          index + 1,
          this.csvEscape(this.registrationName(registration['id'], registrations, persons)),
          score.wins,
          score.pointsFor,
          score.pointsAgainst,
        ].join(','),
      );
    });
    return lines.join('\n');
  }

  private registrationName(
    registrationId: unknown,
    registrations: ArchiveRow[],
    persons: ArchiveRow[],
  ): string {
    if (typeof registrationId !== 'string') return '';
    const registration = registrations.find((row) => row['id'] === registrationId);
    const person = persons.find((row) => row['id'] === registration?.['person_id']);
    if (!person) return registrationId;
    return `${person['given_name'] as string} ${person['family_name'] as string}`;
  }

  private parseArchive(buffer: Buffer): MyClashArchive {
    const trimmed = buffer.toString('utf8').trimStart();
    const parsed = trimmed.startsWith('{') ? JSON.parse(trimmed) : this.parseZipManifest(buffer);
    if (!isArchive(parsed)) {
      throw new BadRequestException('Unsupported archive format.');
    }
    return parsed;
  }

  private parseZipManifest(buffer: Buffer): unknown {
    let offset = 0;
    while (offset + 30 < buffer.length) {
      if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      const nameStart = offset + 30;
      const dataStart = nameStart + fileNameLength + extraLength;
      const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
      if (name === 'manifest.json') {
        return JSON.parse(buffer.subarray(dataStart, dataStart + compressedSize).toString('utf8'));
      }
      offset = dataStart + compressedSize;
    }
    throw new BadRequestException('Unsupported archive format.');
  }

  private countArchiveRows(archive: MyClashArchive): Record<string, number> {
    const tables = normalizeArchiveTables(archive.data);
    return Object.fromEntries(
      Object.entries(tables).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0]),
    );
  }

  private async getRequiredRow(table: string, id: string, label: string): Promise<ArchiveRow> {
    const { data, error } = await this.db().from(table).select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`${label} ${id} not found`);
    return data;
  }

  private async listRows(table: string, column: string, value: unknown): Promise<ArchiveRow[]> {
    return this.listRowsByIds(table, column, [value]);
  }

  private async listRowsByIds(
    table: string,
    column: string,
    values: unknown[],
  ): Promise<ArchiveRow[]> {
    if (values.length === 0) return [];
    const query =
      values.length === 1
        ? this.db().from(table).select('*').eq(column, values[0])
        : this.db().from(table).select('*').in(column, values);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  private async insertRows(table: string, rows: ArchiveRow[]): Promise<void> {
    const { error } = await this.db().from(table).insert(rows).select('*');
    if (error) throw new BadRequestException(error.message);
  }

  private async uniqueEventSlug(orgId: string, desired: string): Promise<string> {
    return this.uniqueSlug('events', 'organization_id', orgId, desired);
  }

  private async uniqueTournamentSlug(eventId: string, desired: string): Promise<string> {
    return this.uniqueSlug('tournaments', 'event_id', eventId, desired);
  }

  private async uniqueSlug(
    table: string,
    scopeColumn: string,
    scopeId: string,
    desired: string,
  ): Promise<string> {
    let candidate = desired
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { data } = await this.db()
        .from(table)
        .select('id')
        .eq(scopeColumn, scopeId)
        .eq('slug', candidate)
        .maybeSingle();
      if (!data) return candidate;
      candidate = `${desired}-${attempt + 1}`;
    }
    throw new ConflictException('Could not find an available restored slug.');
  }

  private async auditRestore(
    userId: string,
    scope: ArchiveScope,
    sourceId: string,
    restoredId: string,
  ): Promise<void> {
    // `this.db()` rather than supabase.service: restore runs against a caller-
    // supplied client so a dry run can be pointed at a scratch database.
    await insertAuditLog(this.db(), {
      actorUserId: userId,
      action: `archive_restore_${scope}`,
      entityType: scope,
      entityId: restoredId,
      payload: { sourceId, restoredId, mode: 'copy' },
    });
  }

  private cleanRow(row: ArchiveRow): ArchiveRow {
    return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  }

  /**
   * Formula-safe: archive CSVs are downloaded and opened in a spreadsheet, and
   * carry organiser-written names and labels. See @myclash/types/csv.
   */
  private csvEscape(value: string): string {
    return escapeCsvCell(value);
  }

  private safeFilename(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-|-$/g, '') || 'tournament'
    );
  }

  private db(): DbClient {
    return this.supabase.service as unknown as DbClient;
  }
}

interface IdMaps {
  events: Map<string, string>;
  themes: Map<string, string>;
  lices: Map<string, string>;
  persons: Map<string, string>;
  fighters: Map<string, string>;
  tournaments: Map<string, string>;
  registrations: Map<string, string>;
  phases: Map<string, string>;
  pools: Map<string, string>;
  bracketSlots: Map<string, string>;
  swissRounds: Map<string, string>;
  matches: Map<string, string>;
  workshops: Map<string, string>;
  workshopSessions: Map<string, string>;
  // Named maps for ids referenced by OTHER tables' FK columns.
  refereeSkills: Map<string, string>;
  matchForfeits: Map<string, string>;
  matchPenalties: Map<string, string>;
  tournamentSlotConfig: Map<string, string>;
  eventSlotConfig: Map<string, string>;
  // Fallback per-table id maps for tables whose id is not referenced elsewhere
  // but must still be regenerated to avoid PK collisions on a same-DB restore.
  generic: Map<string, Map<string, string>>;
}

function createIdMaps(): IdMaps {
  return {
    events: new Map(),
    themes: new Map(),
    lices: new Map(),
    persons: new Map(),
    fighters: new Map(),
    tournaments: new Map(),
    registrations: new Map(),
    phases: new Map(),
    pools: new Map(),
    bracketSlots: new Map(),
    swissRounds: new Map(),
    matches: new Map(),
    workshops: new Map(),
    workshopSessions: new Map(),
    refereeSkills: new Map(),
    matchForfeits: new Map(),
    matchPenalties: new Map(),
    tournamentSlotConfig: new Map(),
    eventSlotConfig: new Map(),
    generic: new Map(),
  };
}

// Returns the id map for a table's own primary key. Named maps are used when
// another table's FK points at this id; everything else falls back to a lazily
// created per-table map so EVERY id-bearing row gets a fresh id on restore.
function jsonIdPathsFor(table: keyof typeof TABLE_TO_ARCHIVE_KEY): readonly JsonIdPath[] {
  const declared = JSON_ID_PATHS as Partial<
    Record<keyof typeof TABLE_TO_ARCHIVE_KEY, readonly JsonIdPath[]>
  >;
  return declared[table] ?? [];
}

function jsonIdMap(name: JsonIdMapName, maps: IdMaps): Map<string, string> {
  return maps[name];
}

function idMapForTable(
  table: keyof typeof TABLE_TO_ARCHIVE_KEY,
  maps: IdMaps,
): Map<string, string> {
  const named: Partial<Record<keyof typeof TABLE_TO_ARCHIVE_KEY, Map<string, string>>> = {
    events: maps.events,
    themes: maps.themes,
    lices: maps.lices,
    persons: maps.persons,
    tournaments: maps.tournaments,
    registrations: maps.registrations,
    phases: maps.phases,
    pools: maps.pools,
    bracket_slots: maps.bracketSlots,
    swiss_rounds: maps.swissRounds,
    matches: maps.matches,
    workshops: maps.workshops,
    workshop_sessions: maps.workshopSessions,
    referee_skills: maps.refereeSkills,
    match_forfeits: maps.matchForfeits,
    match_penalties: maps.matchPenalties,
    tournament_slot_config: maps.tournamentSlotConfig,
    event_slot_config_default: maps.eventSlotConfig,
  };
  const namedMap = named[table];
  if (namedMap) return namedMap;
  let generic = maps.generic.get(table);
  if (!generic) {
    generic = new Map();
    maps.generic.set(table, generic);
  }
  return generic;
}

function normalizeArchiveTables(
  data: MyClashArchive['data'] | Partial<ArchiveTables>,
): ArchiveTables {
  return {
    ...EMPTY_TABLES,
    ...Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? [...value] : []]),
    ),
  };
}

function ids(rows: ArchiveRow[]): string[] {
  return idsByColumn(rows, 'id');
}

function idsByColumn(rows: ArchiveRow[], column: string): string[] {
  return rows
    .map((row) => row[column])
    .filter((value): value is string => typeof value === 'string');
}

function isArchive(value: unknown): value is MyClashArchive {
  const candidate = value as Partial<MyClashArchive>;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.manifest === 'myclash.archive.v1' &&
    candidate.version === 1 &&
    (candidate.scope === 'event' || candidate.scope === 'tournament') &&
    (candidate.include === 'structure' || candidate.include === 'scoring') &&
    typeof candidate.source === 'object' &&
    candidate.source !== null &&
    typeof candidate.data === 'object' &&
    candidate.data !== null
  );
}
