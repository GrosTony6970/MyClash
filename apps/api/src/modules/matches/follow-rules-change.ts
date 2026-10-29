import type { BoutDeps } from './fighter-bouts';
import { isOut } from './fighter-cause';
import { unfoughtBoutsOf } from './fighter-reconcile';

/**
 * The Fighters follow an audited change of a Tournament's forfeit rules (the audited settings
 * change, revisions 13-18 of its plan; operator rulings 143, 144, 146, 149, 153, 157-161).
 *
 * The database names who to settle and in what order (`fighters_status_under`, 0246): those whose
 * status the change moves, those whose stored status is out of step with the rules after, by when
 * they crossed out, then those coming back. This module settles them in that order and sorts
 * nothing. Each settle reads the rules now in force itself (ruling 149), and the caller holds every
 * hand-off of the completion owner until the last settle.
 *
 * THE HOLD-BACK (rulings 153, 158). Of two Fighters out on one unfought bout, the first to cross
 * forfeits it (146). When a settle fails, a later Fighter going out who shares an unfought bout
 * with them is HELD, not settled: settled, they would forfeit that bout to the Fighter who crossed
 * first. The chain follows: one sharing a bout with a held Fighter is held too. A Fighter coming
 * back is never held. The bouts are read only once something failed, through the one reader of
 * "which bouts" (`unfoughtBoutsOf`); a failed read holds every later Fighter going out.
 *
 * THE TWO LOOPS. Loop 1 follows the change (`before` → `after`). Loop 2, the out-of-step pass,
 * reads the Tournament under `after` alone, naming loop 1's failed and held Fighters (`p_also`), and
 * decides each one again from a clean start: a failed Fighter is retried before the ones held behind
 * them (ruling 157). When its read fails, it retries loop 1's failed and held Fighters in loop 1's
 * order (ruling 160A). What is still failed or held after it is `notSettled`.
 */

type Client = BoutDeps['db'];

/** The rules the database reads (`settleRules`): one side of the change. */
export type StatusRules = Record<string, unknown>;

/** One Registration as `fighters_status_under` answers it. */
export interface StatusRow {
  registration_id: string;
  status_now: string;
  status_before: string;
  status_after: string;
  crossed_at: string | null;
}

/** A forfeit rules change as a settle reads it, each side. */
export interface RulesMove {
  before: StatusRules;
  after: StatusRules;
  /** The rules before did not parse (a repair): `before` is `after`. */
  beforeUnparsable: boolean;
}

/**
 * Whether the change moves this Fighter: the dialog names them, and the answer does not count them
 * as brought back in step (ruling 161). In a repair, the Fighters it moves are those out of step
 * with the rules after: their stored status is all there is to compare.
 */
export function isMovedBy(change: RulesMove, row: StatusRow): boolean {
  return statusBeforeOf(change, row) !== row.status_after;
}

/** The status the change moves this Fighter from: the stored one in a repair. */
export function statusBeforeOf(change: RulesMove, row: StatusRow): string {
  return change.beforeUnparsable ? row.status_now : row.status_before;
}

export interface FollowDeps {
  db: Client;
  /** One Fighter's settle, its hand-off held by the caller; throws when the settle failed. */
  settle: (registrationId: string) => Promise<unknown>;
  /** A step that failed, for the log. */
  logged: (step: string, error: unknown) => void;
}

/** What the follow did. */
export interface RulesFollowed {
  /** Every Fighter failed or held after loop 2, in its order. */
  notSettled: string[];
  /**
   * Fighters settled whom the change itself did not move (`isMovedBy`): their stored status was out
   * of step. Never one in `notSettled`; in a repair, only one a later write put out of step.
   */
  inStep: string[];
  /** A read of the set or of a Fighter's bouts failed: the follow may be partial. */
  followFailed: boolean;
}

const READ = 'fighters_status_under';

/** The Registrations of the Tournament to settle, in the database's order. Throws on a failure. */
export async function statusRows(
  db: Client,
  tournamentId: string,
  before: StatusRules,
  after: StatusRules,
  also: readonly string[],
): Promise<StatusRow[]> {
  const { data, error } = await db.rpc(READ, {
    p_tournament: tournamentId,
    p_rules_before: before,
    p_rules_after: after,
    p_also: [...also],
  });
  if (error)
    throw new Error(`The Fighters of Tournament ${tournamentId} were not read: ${error.message}`);
  return (data ?? []) as StatusRow[];
}

/** One loop's outcome: who is failed or held, in the order decided, and whether a read failed. */
interface Loop {
  blocked: string[];
  readFailed: boolean;
}

export async function followRulesChangeOf(
  deps: FollowDeps,
  tournamentId: string,
  change: RulesMove,
): Promise<RulesFollowed> {
  const { before, after } = change;
  const settled: string[] = [];
  let first: StatusRow[] | null = null;
  try {
    first = await statusRows(deps.db, tournamentId, before, after, []);
  } catch (error) {
    deps.logged(`The Fighters of Tournament ${tournamentId}`, error);
  }
  const loop1 = await settleInOrder(deps, tournamentId, first ?? [], settled);
  let second: StatusRow[];
  let secondFailed = false;
  try {
    second = await statusRows(deps.db, tournamentId, after, after, loop1.blocked);
  } catch (error) {
    deps.logged(`The Fighters out of step in Tournament ${tournamentId}`, error);
    secondFailed = true;
    const rowOf = new Map((first ?? []).map((row) => [row.registration_id, row]));
    second = loop1.blocked.map((id) => rowOf.get(id)!);
  }
  const loop2 = await settleInOrder(deps, tournamentId, second, settled);
  // Who the change itself moved is known from loop 1's read alone. One settled in loop 1 and failed
  // in loop 2 (a write in between) is not settled: not in step either.
  const notInStep = new Set([
    ...(first ?? []).filter((r) => isMovedBy(change, r)).map((r) => r.registration_id),
    ...loop2.blocked,
  ]);
  return {
    notSettled: loop2.blocked,
    inStep: first ? [...new Set(settled)].filter((id) => !notInStep.has(id)) : [],
    followFailed: first === null || secondFailed || loop1.readFailed || loop2.readFailed,
  };
}

/**
 * One loop: those going out in the given order, each settled unless held, then those coming back.
 * Every Fighter is tried; a failure is logged and kept.
 */
async function settleInOrder(
  deps: FollowDeps,
  tournamentId: string,
  rows: readonly StatusRow[],
  settled: string[],
): Promise<Loop> {
  const loop: Loop = { blocked: [], readFailed: false };
  const settle = async (id: string) => {
    try {
      await deps.settle(id);
      settled.push(id);
    } catch (error) {
      deps.logged(`Registration ${id}`, error);
      loop.blocked.push(id);
    }
  };
  for (const row of rows.filter((r) => isOut(r.status_after))) {
    if (await isHeld(deps, tournamentId, row.registration_id, loop)) {
      loop.blocked.push(row.registration_id);
    } else {
      await settle(row.registration_id);
    }
  }
  for (const row of rows.filter((r) => !isOut(r.status_after))) await settle(row.registration_id);
  return loop;
}

/**
 * Whether a Fighter going out must wait: one of their unfought bouts faces a Fighter failed or held
 * before them. Nothing is read while nothing failed; once a read fails, everyone later waits.
 */
async function isHeld(
  deps: FollowDeps,
  tournamentId: string,
  registrationId: string,
  loop: Loop,
): Promise<boolean> {
  if (loop.readFailed) return true;
  if (loop.blocked.length === 0) return false;
  const blocked = new Set(loop.blocked);
  try {
    const bouts = await unfoughtBoutsOf(deps.db, tournamentId, registrationId);
    return bouts.some((bout) =>
      [bout['red_registration_id'], bout['blue_registration_id']].some(
        (corner) => corner !== registrationId && blocked.has(corner as string),
      ),
    );
  } catch (error) {
    deps.logged(`The bouts of registration ${registrationId}`, error);
    loop.readFailed = true;
    return true;
  }
}
