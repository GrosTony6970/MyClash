import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createStoredZip } from '../../common/stored-zip';
import { buildTournamentReports, emptyTournamentReports, safeFilename } from './archive-reports';
import { ID_MAP_NAMES } from './archive.table-spec';
import type { CollectContext, CollectRule, IdMapName } from './archive.table-spec';
import {
  INSERT_ORDER,
  TABLE_TO_ARCHIVE_KEY,
  collectRuleFor,
  emptyArchiveTables,
  idMapNameForTable,
  jsonIdPathsFor,
} from './archive.tables';
import type { ArchiveTableName } from './archive.tables';
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
    return archive.reports.tournaments[0] ?? emptyTournamentReports(tournamentId);
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
      const prefix = `reports/${safeFilename(report.tournamentName)}`;
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
    table: ArchiveTableName,
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
    return this.collectTables('event', event, include, { events: [event] });
  }

  private async collectTournamentTables(
    event: ArchiveRow,
    tournament: ArchiveRow,
    include: ArchiveInclude,
  ): Promise<ArchiveTables> {
    return this.collectTables('tournament', event, include, {
      events: [event],
      tournaments: [tournament],
    });
  }

  /**
   * Gather every table its registry entry says belongs in this scope.
   *
   * Resolution is on demand and memoised, following each rule's `from` edge —
   * NOT the declaration order. The two orders genuinely differ:
   * `registrations.person_id` means persons must be INSERTED before
   * registrations, while a tournament archive finds its persons THROUGH the
   * registrations. One hand-maintained sequence could not satisfy both, and
   * this way neither has to be maintained at all.
   *
   * A table whose rule is `omit`, or whose `include: 'scoring'` is not met,
   * resolves to an empty array without a query — the same as the structure-only
   * branch the collector used to carry.
   */
  private async collectTables(
    scope: ArchiveScope,
    event: ArchiveRow,
    include: ArchiveInclude,
    roots: Partial<Record<ArchiveTableName, ArchiveRow[]>>,
  ): Promise<ArchiveTables> {
    const eventId = event['id'] as string;
    const resolved = new Map<ArchiveTableName, ArchiveRow[]>();
    const resolving = new Set<ArchiveTableName>();

    const context: CollectContext = {
      eventId,
      get tournamentIds() {
        return ids(resolved.get('tournaments') ?? []);
      },
      idsOf: (table) => ids(resolved.get(table as ArchiveTableName) ?? []),
    };

    const resolve = async (table: ArchiveTableName): Promise<ArchiveRow[]> => {
      const cached = resolved.get(table);
      if (cached) return cached;
      // The registry test proves the graph is acyclic; this is what a cycle
      // introduced tomorrow looks like, instead of a hung export.
      if (resolving.has(table)) {
        throw new Error(`Archive collection cycle through ${table}`);
      }
      resolving.add(table);

      const rows = await this.rowsForRule(table, collectRuleFor(table, scope), {
        include,
        eventId,
        roots,
        resolve,
        context,
      });

      resolving.delete(table);
      resolved.set(table, rows);
      return rows;
    };

    const tables = emptyArchiveTables();
    for (const table of INSERT_ORDER) {
      tables[TABLE_TO_ARCHIVE_KEY[table]] = await resolve(table);
    }
    return tables;
  }

  private async rowsForRule(
    table: ArchiveTableName,
    rule: CollectRule | 'omit',
    env: {
      include: ArchiveInclude;
      eventId: string;
      roots: Partial<Record<ArchiveTableName, ArchiveRow[]>>;
      resolve: (table: ArchiveTableName) => Promise<ArchiveRow[]>;
      context: CollectContext;
    },
  ): Promise<ArchiveRow[]> {
    if (rule === 'omit') return [];
    if (rule.include === 'scoring' && env.include !== 'scoring') return [];

    let rows: ArchiveRow[];
    if (rule.from === 'root') {
      rows = env.roots[table] ?? [];
    } else if (rule.from === 'event') {
      rows = await this.listRows(table, 'event_id', env.eventId);
    } else {
      const parents = await env.resolve(rule.from as ArchiveTableName);
      rows = await this.listRowsByIds(
        table,
        rule.local!,
        idsByColumn(parents, rule.parent ?? 'id'),
      );
    }

    if (!rule.filter) return rows;
    for (const need of rule.needs ?? []) await env.resolve(need as ArchiveTableName);
    return rows.filter((row) => rule.filter!(row, env.context));
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
            ? tables.tournaments.map((row) => buildTournamentReports(row, tables))
            : [],
      },
    };
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

  private db(): DbClient {
    return this.supabase.service as unknown as DbClient;
  }
}

/**
 * The per-restore id maps. Every named member is declared in `ID_MAP_NAMES`;
 * `generic` holds the fallback per-table maps for ids nothing else references,
 * which must still be regenerated to avoid PK collisions on a same-DB restore.
 */
type IdMaps = Record<IdMapName, Map<string, string>> & {
  generic: Map<string, Map<string, string>>;
};

function createIdMaps(): IdMaps {
  return {
    ...(Object.fromEntries(ID_MAP_NAMES.map((name) => [name, new Map<string, string>()])) as Record<
      IdMapName,
      Map<string, string>
    >),
    generic: new Map(),
  };
}

function jsonIdMap(name: IdMapName, maps: IdMaps): Map<string, string> {
  return maps[name];
}

/**
 * The id map for a table's own primary key.
 *
 * A named map when another table's FK points at this id, otherwise a lazily
 * created per-table map — so EVERY id-bearing row gets a fresh id on restore,
 * whether or not anything needs to find it again. Which tables earn a name is
 * declared once, in the registry.
 */
function idMapForTable(table: ArchiveTableName, maps: IdMaps): Map<string, string> {
  const named = idMapNameForTable(table);
  if (named) return maps[named];
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
    ...emptyArchiveTables(),
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
