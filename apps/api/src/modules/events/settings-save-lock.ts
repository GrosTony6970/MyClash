/**
 * The lock of a Tournament's settings save, and the shape of its audited form (the audited settings
 * change, revisions 7-18 of its plan).
 *
 * A save that changes a scoring setting reads the Tournament's clock (`tournamentClockOf`) and lists
 * every change (`scoringChangesOf`), each flagged by `lockedChanges`. When one is locked, the save
 * is refused `rules_change_needs_audit` with the whole list: the dialog shows it, and the organiser
 * sends the same save again with `audit` (the Tournament's name typed, a reason, the rules the screen
 * read). An audited save is recorded even when nothing in it locks: the organiser asked for it.
 *
 * Fail closed: when the clock or the changes cannot be read, the save is refused
 * `rules_check_unavailable` (503), never let through as "nothing started".
 */
import { BadRequestException, ForbiddenException, type Logger } from '@nestjs/common';
import { RULES_CHANGE_CODES, RULES_SAVE_KEYS, type RulesChange } from '@myclash/types';
import { clockLocks, lockedChanges, stableStringify, type RulesClock } from '@myclash/rulesets';
import { OperationalUnavailableException } from '../../common/operational-exception';
import type { RulesetHashService } from '../ruleset-hash/ruleset-hash.service';
import { scoringChangesOf } from './audited-rules-write';

type Row = Record<string, unknown>;

/** The refusal that opens the dialog: every change of the save, the locked ones flagged. */
export function needsAudit(changes: readonly RulesChange[], message: string): ForbiddenException {
  return new ForbiddenException({ code: RULES_CHANGE_CODES.needsAudit, changes, message });
}

/**
 * An audited save carries rules only. A move to another pair is the re-pin's (the dialog sends the
 * owner there: `rules_change_needs_audit` before anything is written); any other field, a name or a
 * status, is `rules_change_mixed`: the record must hold exactly what the organiser confirmed.
 */
export function assertAuditedSaveShape(dto: Row, movesPair: boolean): void {
  if (movesPair) {
    throw needsAudit([], 'A move to another ruleset goes through the audited re-pin.');
  }
  const rulesKeys: readonly string[] = RULES_SAVE_KEYS;
  const others = Object.keys(dto).filter(
    (key) => dto[key] !== undefined && key !== 'audit' && !rulesKeys.includes(key),
  );
  if (others.length === 0) return;
  throw new BadRequestException({
    code: RULES_CHANGE_CODES.mixed,
    message: `An audited change carries rules only; save these on their own: ${others.join(', ')}.`,
  });
}

/** The rules columns of a Tournament row a settings save can change. */
const RULES_COLUMNS = [
  'ruleset_code',
  'ruleset_version',
  'ruleset_config',
  'scoring_config_json',
  'penalty_ruleset_id',
  'penalty_ruleset_version',
  'forfeit_rules',
] as const;

/**
 * Whether a save changes a rules column's VALUE: only such a save is written on the condition that
 * the row is the one it read (`updated_at`), so a save of a name or a status never 409s.
 */
export function changesRulesColumn(read: Row, updates: Row): boolean {
  return RULES_COLUMNS.some(
    (column) =>
      column in updates &&
      stableStringify(updates[column] ?? null) !== stableStringify(read[column] ?? null),
  );
}

export interface SaveLockDeps {
  /** Asked only when the changes are listed: a save of an unstarted Tournament lists none. */
  rulesHash: () => RulesetHashService;
  /** The Tournament's clock, read once per save whichever door asks first, already fail-closed. */
  clock: () => Promise<RulesClock>;
  logger: Logger;
}

export interface SaveLock {
  changes: RulesChange[];
  locked: boolean;
}

/**
 * The lock of a save whose candidate row is `candidate`. Nothing to list when the clock does not
 * lock and the save is not audited: no setting of an unstarted Tournament locks.
 */
export async function lockOfSettingsSave(
  deps: SaveLockDeps,
  read: Row,
  candidate: Row,
  audited: boolean,
): Promise<SaveLock> {
  const tournamentId = String(read['id']);
  const clock = await deps.clock();
  if (!clockLocks(clock) && !audited) return { changes: [], locked: false };
  const listed = await failClosed(deps.logger, tournamentId, () =>
    scoringChangesOf(deps.rulesHash(), read, candidate),
  );
  const changes = lockedChanges(listed, clock);
  return { changes, locked: changes.some((change) => change.locked === true) };
}

/**
 * A read the lock needs, failing closed: any throw is the 503 `rules_check_unavailable`, logged.
 * The save's clock goes through it once, so every door of the save answers the same refusal.
 */
export async function failClosed<T>(
  logger: Pick<Logger, 'warn'>,
  tournamentId: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    logger.warn(`The rules of Tournament ${tournamentId} were not checked: ${String(err)}`);
    throw new OperationalUnavailableException({
      code: RULES_CHANGE_CODES.checkUnavailable,
      message: 'The rules of this tournament could not be checked. Try again in a moment.',
    });
  }
}
