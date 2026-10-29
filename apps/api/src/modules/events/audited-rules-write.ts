/**
 * An audited change of a Tournament's rules: the ONE owner of its write, for both kinds (a
 * ruleset move by the re-pin, a settings change by the settings save; the audited settings change,
 * revision 12 of its plan).
 *
 * The door reads the Tournament, decides the new rules and lists what changes; this module
 * snapshots the placings, then hands the whole change to the database in one call
 * (`repin_tournament_rules`, 0234): it locks the row, refuses when the six rules columns no longer
 * hold what the door read, writes the rules and the record, and stamps the bouts not started.
 * Then the placings after are filled into that record and the change is mirrored in `audit_log`;
 * both are best effort and logged, the record is the source of truth.
 *
 * THE RACE. Two organisers confirm a change from one read: the second call waits on the first's
 * row lock, then reads the row the first wrote, and is refused `rules_changed_since_read` (409).
 * A plain settings save landing between the door's read and the call changes a compared column,
 * so the call is refused, never the save lost. Named and accepted (revision 7 of the plan, revision
 * 11 fold 7): the hash is taken before the call, so an Event default card pin changed in that
 * window leaves a hash of the old pin; the drift banner shows it, and Acknowledge or the next rules
 * save heals it.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  type Logger,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RULES_CHANGE_CODES,
  sameTournamentName,
  type RulesChange,
  type RulesClosedBy,
  type RulesExpected,
} from '@myclash/types';
import type { ForfeitChanges } from '@myclash/types/forfeit-rules';
import { buttonValuesOf, scoringDiff, stableStringify, type BucketDiff } from '@myclash/rulesets';
import { insertAuditLog } from '../../common/audit-log';
import { isOver } from '../../common/live-status';
import type {
  RulesetHashService,
  TournamentHashRow,
  TournamentScoringRow,
} from '../ruleset-hash/ruleset-hash.service';
import { normalizeRulesetVersion } from './ruleset-defaults';

type Row = Record<string, unknown>;
export type Placings = Array<Record<string, unknown>>;

/** The rules columns an audited change compares and the names a screen reads them by. */
const EXPECTED_COLUMNS = {
  rulesetCode: 'ruleset_code',
  rulesetVersion: 'ruleset_version',
  rulesetConfig: 'ruleset_config',
  scoringConfig: 'scoring_config_json',
  penaltyRulesetId: 'penalty_ruleset_id',
  penaltyRulesetVersion: 'penalty_ruleset_version',
  forfeitRules: 'forfeit_rules',
} as const satisfies Record<keyof RulesExpected, string>;

const RPC = 'repin_tournament_rules';

/**
 * A Tournament completed or archived, or one whose Event is (ruling 148): its results are final,
 * no door changes its rules. `isOver` is the one owner of "over"; the Event's own clock completes
 * it (06:00 local the morning after its last day). Asked by the rules paths only, never by a plain
 * save: a status change must still be able to complete a Tournament under a completed Event.
 */
export function assertRulesOpen(read: Row, event: Row): void {
  const closedBy: RulesClosedBy | null = isOver(read['status'])
    ? 'tournament'
    : isOver(event['status'])
      ? 'event'
      : null;
  if (!closedBy) return;
  throw new ForbiddenException({
    code: RULES_CHANGE_CODES.closed,
    closedBy,
    message:
      closedBy === 'tournament'
        ? 'A completed or archived tournament cannot change its rules: its results are final.'
        : 'This tournament belongs to an event that is over, so its rules cannot change.',
  });
}

/**
 * The screen's `expected` against the row as read, column by column, raw, as the database
 * compares them (a missing value and null are one; `"1"` is not `"1.0.0"`).
 */
export function assertReadAsExpected(read: Row, expected: RulesExpected): void {
  const moved = (Object.keys(EXPECTED_COLUMNS) as Array<keyof RulesExpected>).some(
    (key) =>
      stableStringify(read[EXPECTED_COLUMNS[key]] ?? null) !==
      stableStringify(expected[key] ?? null),
  );
  if (!moved) return;
  throw changedSinceRead();
}

/** The one refusal of a screen whose read is stale: by the door's compare or the database's. */
function changedSinceRead(): ConflictException {
  return new ConflictException({
    code: RULES_CHANGE_CODES.changedSinceRead,
    message: 'The rules of this tournament changed since you opened them. Reload and check them.',
  });
}

/** The typed name must be the Tournament's stored name (operator ruling "Typed name"). */
export function assertConfirmedName(confirm: string, read: Row): void {
  if (sameTournamentName(confirm, String(read['name'] ?? ''))) return;
  throw new BadRequestException({
    code: RULES_CHANGE_CODES.confirmMismatch,
    message: 'The name typed is not the name of this tournament.',
  });
}

/**
 * The rules an audited change writes: the pair, its two settings, and the Tournament's own changes
 * of its forfeit rules (0246), the stored value as it is when the change does not touch them.
 */
export interface NextRules {
  rulesetCode: string;
  rulesetVersion: string;
  rulesetConfig: unknown;
  scoringConfig: unknown;
  forfeitRules: ForfeitChanges | null;
}

/**
 * The rules columns as the database will hold them: each value through JSON, as `jsonb` stores
 * it (an undefined key gone), so the hash is taken over what is written. The forfeit rules are
 * NOT defaulted: a caller that forgot them drops the key, and the database refuses
 * `p_next_incomplete` rather than wipe them.
 */
function nextColumns(next: NextRules): Row {
  return JSON.parse(
    JSON.stringify({
      ruleset_code: next.rulesetCode,
      ruleset_version: next.rulesetVersion,
      ruleset_config: next.rulesetConfig ?? null,
      scoring_config_json: next.scoringConfig ?? null,
      forfeit_rules: next.forfeitRules,
    }),
  ) as Row;
}

/** The Tournament row once `next` is written over it. */
export function appliedRow(read: Row, next: NextRules): Row {
  return { ...read, ...nextColumns(next) };
}

/** Every scoring change between two rows: their canonicals and their button values. */
export async function scoringChangesOf(
  rulesHash: RulesetHashService,
  before: Row,
  after: Row,
): Promise<RulesChange[]> {
  const side = async (row: Row) => ({
    canonical: await rulesHash.scoringCanonicalOf(row as unknown as TournamentScoringRow),
    buttons: buttonValuesOf(row['scoring_config_json'] as Row | null),
  });
  const [was, now] = await Promise.all([side(before), side(after)]);
  return scoringDiff(was, now);
}

export interface AuditedRulesDeps {
  db: SupabaseClient;
  rulesHash: RulesetHashService;
  snapshotPlacings: (tournamentId: string) => Promise<Placings>;
  logger: Logger;
}

export interface AuditedRulesInput {
  kind: 'ruleset' | 'settings';
  /** The Tournament row as the door read it, every column. */
  read: Row;
  next: NextRules;
  actorUserId: string;
  justification: string;
  diff: BucketDiff;
  changes: RulesChange[];
}

/** What an audited settings save answers: the row as written, or none when it was not read back. */
export interface SettingsWritten {
  row: Row | null;
  readBackFailed: boolean;
}

/**
 * Write an audited rules change and answer the Tournament row as written. Refuses 409
 * `rules_changed_since_read` when the row moved since `read`; nothing is written then.
 *
 * Once the database has committed, the settings kind never fails: a row that is not read back
 * answers `readBackFailed` (the change and its record are written; the screen reloads them). The
 * re-pin still throws there, as it always did: its screen has nothing to do after the write.
 */
export async function writeAuditedRules(
  deps: AuditedRulesDeps,
  input: AuditedRulesInput & { kind: 'ruleset' },
): Promise<Row>;
export async function writeAuditedRules(
  deps: AuditedRulesDeps,
  input: AuditedRulesInput & { kind: 'settings' },
): Promise<SettingsWritten>;
export async function writeAuditedRules(
  deps: AuditedRulesDeps,
  input: AuditedRulesInput,
): Promise<Row | SettingsWritten> {
  const tournamentId = await commitAuditedRules(deps, input);
  if (input.kind === 'ruleset') return reread(deps.db, tournamentId);
  try {
    return { row: await reread(deps.db, tournamentId), readBackFailed: false };
  } catch (err) {
    deps.logger.warn(String(err));
    return { row: null, readBackFailed: true };
  }
}

/** Placings, the database call, then the two best-effort follow-ups; answers the Tournament id. */
async function commitAuditedRules(
  deps: AuditedRulesDeps,
  input: AuditedRulesInput,
): Promise<string> {
  const tournamentId = String(input.read['id']);
  const placingsBefore = await deps.snapshotPlacings(tournamentId);
  const next = nextColumns(input.next);
  const hash = await deps.rulesHash.contentHashOf({
    ...input.read,
    ...next,
  } as unknown as TournamentHashRow);
  const { data, error } = await deps.db.rpc(RPC, {
    p_tournament_id: tournamentId,
    p_expected: expectedOf(input.read),
    p_next: { ...next, ruleset_content_hash: hash },
    p_audit: auditOf(input, placingsBefore),
  });
  if (error) throw refusalOf(error, tournamentId);
  const repinId = String(data);
  await fillPlacingsAfter(deps, tournamentId, repinId);
  await mirrorInAuditLog(deps, input, repinId);
  return tournamentId;
}

/** The rules columns as read: what the database compares the row with before it writes. */
function expectedOf(read: Row): Row {
  return Object.fromEntries(
    Object.values(EXPECTED_COLUMNS).map((column) => [column, read[column] ?? null]),
  );
}

/** The pair a Tournament is on, as a record names it and a move starts from: one owner. */
export function pairOf(read: Row): { code: string; version: string } {
  return {
    code: (read['ruleset_code'] as string | null) ?? 'TF_v1',
    version: normalizeRulesetVersion((read['ruleset_version'] as string | null) ?? '1'),
  };
}

function auditOf(input: AuditedRulesInput, placingsBefore: Placings): Row {
  const from = pairOf(input.read);
  return {
    actor_user_id: input.actorUserId === 'unknown' ? null : input.actorUserId,
    kind: input.kind,
    from_code: from.code,
    from_version: from.version,
    to_code: input.next.rulesetCode,
    to_version: input.next.rulesetVersion,
    justification: input.justification,
    bucket_diff: input.diff,
    ranking_compatible: input.diff.rankingCompatible,
    placings_before: placingsBefore,
    config_before: {
      rulesetConfig: input.read['ruleset_config'] ?? null,
      scoringConfig: input.read['scoring_config_json'] ?? null,
      forfeitRules: input.read['forfeit_rules'] ?? null,
    },
    config_after: {
      rulesetConfig: input.next.rulesetConfig ?? null,
      scoringConfig: input.next.scoringConfig ?? null,
      forfeitRules: input.next.forfeitRules ?? null,
    },
    changes: input.changes,
  };
}

/** The database's refusal, as the door answers it. */
function refusalOf(error: { code?: string; message: string }, tournamentId: string): Error {
  if (error.code === 'P0001' && error.message.includes(RULES_CHANGE_CODES.changedSinceRead)) {
    return changedSinceRead();
  }
  if (error.code === 'P0002') return new NotFoundException(`Tournament ${tournamentId} not found`);
  return new Error(`The rules of Tournament ${tournamentId} were not written: ${error.message}`);
}

/** The one fill of the record's placings after. Best effort: the change is written. */
async function fillPlacingsAfter(
  deps: AuditedRulesDeps,
  tournamentId: string,
  repinId: string,
): Promise<void> {
  try {
    const placings = await deps.snapshotPlacings(tournamentId);
    const { error } = await deps.db
      .from('tournament_ruleset_repins')
      .update({ placings_after: placings })
      .eq('id', repinId);
    if (error) throw new Error(error.message);
  } catch (err) {
    deps.logger.warn(
      `The placings after rules change ${repinId} were not recorded: ${String(err)}`,
    );
  }
}

/** The super-admin trail's copy of the change. Best effort: the record is the source of truth. */
async function mirrorInAuditLog(
  deps: AuditedRulesDeps,
  input: AuditedRulesInput,
  repinId: string,
): Promise<void> {
  const audit = auditOf(input, []);
  const { error } = await insertAuditLog(deps.db, {
    actorUserId: audit['actor_user_id'] as string | null,
    action: 'tournament.ruleset.repin',
    entityType: 'tournament',
    entityId: String(input.read['id']),
    payload: {
      repinId,
      kind: input.kind,
      eventId: input.read['event_id'],
      fromCode: audit['from_code'],
      fromVersion: audit['from_version'],
      toCode: audit['to_code'],
      toVersion: audit['to_version'],
      rankingCompatible: audit['ranking_compatible'],
    },
  });
  if (error) deps.logger.warn(`Rules change ${repinId} was not mirrored: ${error.message}`);
}

/** The Tournament row as the change wrote it. */
async function reread(db: SupabaseClient, tournamentId: string): Promise<Row> {
  const { data, error } = await db
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error || !data) {
    const why = error?.message ?? 'no row';
    throw new Error(`Tournament ${tournamentId} changed its rules but was not read back: ${why}`);
  }
  return data as Row;
}
