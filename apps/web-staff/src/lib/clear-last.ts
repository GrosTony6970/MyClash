import { failureCode, type ApiFailure } from '@myclash/api-client';
import type { OutboxEntry } from '../offline/db';
import { classifySyncFailure } from '../offline/failure-kind';
import { newestOf } from '../offline/newest-entry';
import { getPendingForMatch } from '../offline/outbox';
import type { TakenBack } from '../offline/take-back';
import { forgetUndone, listUndone } from '../offline/undone';
import { refusalMessage } from './refusal-copy';
import { readServerEntries, type ServerRow } from './server-entries';
import { settleUndone } from './settle-undone';
import { askVoid, type ServerEntry } from './void-entry';

type Translate = Parameters<typeof refusalMessage>[1];

export type ClearLastOutcome =
  /** The entry is gone: deleted on the tablet, or voided on the server. */
  | { kind: 'voided' }
  /**
   * The Event is over: for an organiser's account the server files a correction
   * request and answers 202. The hit is NOT voided, and stays on the screen
   * until somebody approves the request.
   */
  | { kind: 'sent-for-review' }
  /** `message` is null when there is nothing to say (the bout holds no entry). */
  | { kind: 'failed'; message: string | null };

/**
 * Still the classifier the outbox drain uses, so the pad keeps ONE failure
 * vocabulary: the service worker's synthetic 503 reads as offline, not as the
 * server having an opinion. A `network` failure is the same event one layer
 * down, which is the status 0 it already took.
 */
function failed(failure: ApiFailure, t: Translate): ClearLastOutcome {
  const status = failure.kind === 'aborted' || failure.kind === 'network' ? 0 : failure.status;
  // The code tells read-only mode's 503 from a dead network: `refusalMessage` says it.
  const offline = classifySyncFailure(status, { code: failureCode(failure) }) === 'offline';
  return {
    kind: 'failed',
    message: offline
      ? t('scoring.corrections.onlineOnly')
      : refusalMessage(failure, t, 'scoring.corrections.clearLastFailed'),
  };
}

/**
 * Void one entry the server holds: the server half of the undo.
 *
 * The 202 was read as a void that landed: the screen refreshed, said nothing,
 * and the hit stayed.
 */
export async function voidOnServer(
  apiUrl: string,
  entry: ServerEntry,
  t: Translate,
): Promise<ClearLastOutcome> {
  const result = await askVoid(apiUrl, entry);
  if (result.ok) return { kind: result.data?.pendingReview ? 'sent-for-review' : 'voided' };
  return failed(result, t);
}

/** The entry an undo takes back: one the server holds, or one that waits on the tablet. */
export type ToUndo = { where: 'server'; row: ServerRow } | { where: 'tablet'; entry: OutboxEntry };

/**
 * The last line of the bout's list, as the screen draws it: the server's live
 * entries, then the tablet's waiting ones that no live server entry is. A
 * waiting entry the server holds is ONE entry, the server's (its answer was
 * lost on the way back). `rows` is null when the server could not be asked:
 * the tablet's entries are all there is to go on.
 */
export function newestToUndo(rows: ServerRow[] | null, waiting: OutboxEntry[]): ToUndo | undefined {
  const live = (rows ?? []).filter((row) => !row.voided);
  const held = new Set(live.map((row) => row.clientUuid));
  const list: ToUndo[] = [
    ...live.map((row) => ({ where: 'server' as const, row })),
    ...waiting
      .filter((entry) => !held.has(entry.clientUuid))
      .map((entry) => ({ where: 'tablet' as const, entry })),
  ];
  return newestOf(list, (line) => (line.where === 'server' ? line.row : line.entry));
}

interface UndoDeps {
  apiUrl: string;
  matchId: string;
  t: Translate;
  takeBack: (entry: OutboxEntry) => Promise<TakenBack>;
}

/** The server holds the newest entry: it is voided there, and its copy leaves the tablet. */
async function undoOnServer(
  deps: UndoDeps,
  row: ServerRow,
  waiting: OutboxEntry[],
): Promise<ClearLastOutcome> {
  const outcome = await voidOnServer(deps.apiUrl, row, deps.t);
  const copy = waiting.find((entry) => entry.clientUuid === row.clientUuid);
  if (outcome.kind === 'voided' && copy) {
    // The void landed whatever happens here: a copy that stays is sent again, and the
    // server answers it with the voided entry it holds.
    try {
      await deps.takeBack(copy);
      await forgetUndone(copy.clientUuid);
    } catch (err) {
      console.error('[undo] the copy of a voided entry stayed on the tablet', err);
    }
  }
  return outcome;
}

/** The server took it while the undo waited: voided by its id, read again when it gave none. */
async function undoLanded(
  deps: UndoDeps,
  entry: OutboxEntry,
  serverId: string,
): Promise<ClearLastOutcome> {
  const { apiUrl, t } = deps;
  const kind = entry.kind ?? 'exchange';
  // No id (the store kept none, or the entry's own uuid after a second try).
  if (serverId && serverId !== entry.clientUuid) {
    return voidOnServer(apiUrl, { kind, id: serverId }, t);
  }
  const read = await readServerEntries(apiUrl, deps.matchId);
  if ('failure' in read) return failed(read.failure, t);
  const held = read.rows.find((row) => row.clientUuid === entry.clientUuid && !row.voided);
  return held ? voidOnServer(apiUrl, held, t) : { kind: 'failed', message: null };
}

/**
 * The newest entry waits on the tablet. Off the tablet it is written down
 * (`takeOffTablet`); then the server is asked for it, by the settle. A server
 * that could not be asked a moment ago is not asked again: the entry stays
 * written down, and the screen's watcher settles it later.
 */
async function undoOnTablet(
  deps: UndoDeps,
  entry: OutboxEntry,
  serverAnswered: boolean,
): Promise<ClearLastOutcome> {
  const taken = await deps.takeBack(entry);
  if (taken.kind === 'landed') return undoLanded(deps, entry, taken.serverId);
  if (!serverAnswered) return { kind: 'voided' };
  const run = await settleUndone(deps.apiUrl, deps.matchId, entry.clientUuid);
  const settled = run.get(entry.clientUuid);
  if (settled === 'review') return { kind: 'sent-for-review' };
  if (typeof settled === 'object') return failed(settled.refused, deps.t);
  // Also when the screen's watcher settled it first: it reads the bout again itself.
  return { kind: 'voided' };
}

/**
 * "Undo last entry": take back the newest hit or card of a bout, wherever it
 * is (rulings 317, 318, 350).
 *
 * The server is asked first, for a short time: the newest entry is the last
 * line of the server's entries and the tablet's waiting ones together. With
 * no answer the undo works on the tablet alone, as it does offline. The
 * tablet's entries are read at the tap, before the server: a hit pressed
 * during the read is not the one undone.
 *
 * An entry an earlier undo took off the tablet is gone for the referee, even
 * while the server still holds it: the settle voids that one, the screen's
 * lists leave it out (`useTakenBack`), and this tap takes back the entry
 * before it.
 *
 * The race is the settle voiding and forgetting such an entry while this tap
 * reads. So what is written down is read BEFORE the server: an entry forgotten
 * during the read is still left out, and it is voided by then.
 */
export async function undoLastEntry(deps: UndoDeps): Promise<ClearLastOutcome> {
  const waiting = await getPendingForMatch(deps.matchId);
  const takenBack = new Set((await listUndone()).map((entry) => entry.clientUuid));
  const read = await readServerEntries(deps.apiUrl, deps.matchId);
  const rows = 'rows' in read ? read.rows.filter((row) => !takenBack.has(row.clientUuid)) : null;
  const newest = newestToUndo(rows, waiting);
  if (!newest) {
    return 'failure' in read ? failed(read.failure, deps.t) : { kind: 'failed', message: null };
  }
  if (newest.where === 'server') return undoOnServer(deps, newest.row, waiting);
  return undoOnTablet(deps, newest.entry, 'rows' in read);
}
