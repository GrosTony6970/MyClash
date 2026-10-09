import { apiRequest, type ApiFailure } from '@myclash/api-client';
import { db, type UndoNotice, type UndoneEntry } from '../offline/db';
import { dropUnreadNotices } from '../offline/undo-notices';
import { KEPT_FOR_MS, listUndone } from '../offline/undone';
import { readServerEntries, type ServerRead } from './server-entries';
import { heldTo, SERVER_LIMIT_MS } from './time-limit';
import { askVoid } from './void-entry';

/**
 * What became of one entry the undo took off the tablet. `voided`: the server
 * held it and it is voided there. `review`: the Event is over, a request was
 * filed. `absent`: the server holds no live entry of that id. `kept`: the
 * server could not be asked, it is tried again. `refused`: the server judged
 * the request and said no, about an entry of the bout `matchId`. `expired`:
 * nobody could ask for a day. `ended`: the bout was completed meanwhile, and
 * the tablet corrects no finished bout by itself (ruling 366).
 */
export type Settled =
  | 'voided'
  | 'review'
  | 'absent'
  | 'kept'
  | 'expired'
  | 'ended'
  | { refused: ApiFailure; matchId: string };

/**
 * The statuses the API judges the REQUEST by: the bout is gone, locked, or its
 * Event is over. The pad does not send it again by itself: the hit is on the
 * list again, and a tap on Undo says why. Never a 401 or a 403: those are
 * about who is signed in, and another sign-in passes.
 */
const JUDGED = [400, 404, 409];

/** A judgment the API worded (a code). An answer with no code is the edge's. */
export function isVerdict(failure: ApiFailure): boolean {
  return 'status' in failure && failure.code !== null && JUDGED.includes(failure.status);
}

/** One run: the entry the referee is undoing now, and each bout's status, read once. */
interface Run {
  apiUrl: string;
  tapped?: string;
  ended: Map<string, Promise<boolean | null>>;
}

/** What the bout's screen says later of an undo that was not carried out (rulings 364, 365). */
function noticeOf(entry: UndoneEntry, settled: Settled): UndoNotice | null {
  const { clientUuid, matchId } = entry;
  const writtenAt = Date.now();
  if (settled === 'expired' || settled === 'ended') {
    return { clientUuid, matchId, why: settled, writtenAt };
  }
  if (typeof settled !== 'object') return null;
  return { clientUuid, matchId, why: 'refused', refusal: settled.refused, writtenAt };
}

async function forget(run: Run, entry: UndoneEntry, settled: Settled): Promise<Settled> {
  const notice = noticeOf(entry, settled);
  if (notice) {
    console.warn('[undo] an undo taken on the tablet was not settled with the server', {
      entry,
      settled,
    });
  }
  // One step: an undo forgotten with no notice written comes back with no word.
  await db.transaction('rw', db.undone, db.undoNotices, async () => {
    // The undo the referee is tapping now is answered at his button, at once.
    if (notice && entry.clientUuid !== run.tapped) await db.undoNotices.put(notice);
    await db.undone.delete(entry.clientUuid);
  });
  return settled;
}

const refuse = (run: Run, entry: UndoneEntry, refused: ApiFailure) =>
  forget(run, entry, { refused, matchId: entry.matchId });

/** Does the server hold the bout completed? Null: it gave no answer to go on. */
function boutEnded(run: Run, matchId: string): Promise<boolean | null> {
  const known = run.ended.get(matchId);
  if (known) return known;
  const read = heldTo(
    SERVER_LIMIT_MS,
    (signal) =>
      apiRequest<{ status?: string }>(run.apiUrl, `/api/v1/matches/${matchId}`, { signal }),
    { ok: false as const, kind: 'aborted' as const },
  ).then((bout) => {
    const status = bout.ok ? bout.data?.status : undefined;
    return typeof status === 'string' ? status === 'completed' : null;
  });
  run.ended.set(matchId, read);
  return read;
}

/**
 * The entries a referee is undoing at this moment. A finished bout still takes
 * their void (ruling 366), whichever run reaches them first: the undo's own,
 * or the watcher's, which can start between the write of the entry and the
 * undo's own run.
 */
const attended = new Set<string>();

/** Mark an entry as being undone now, BEFORE it is written down. Answers its unmark. */
export function attendUndo(clientUuid: string): () => void {
  attended.add(clientUuid);
  return () => void attended.delete(clientUuid);
}

async function settleOne(run: Run, entry: UndoneEntry, read: ServerRead): Promise<Settled> {
  if ('failure' in read) {
    return isVerdict(read.failure) ? refuse(run, entry, read.failure) : 'kept';
  }
  const held = read.rows.find((row) => row.clientUuid === entry.clientUuid && !row.voided);
  if (!held) return forget(run, entry, 'absent');
  // A void on a finished bout is a correction: it can decide the bout again or
  // put it back in play. Only an undo being tapped now is sent there; one the
  // tablet remembered is let go, and the bout's screen says so (ruling 366).
  if (!attended.has(entry.clientUuid)) {
    const ended = await boutEnded(run, entry.matchId);
    if (ended === null) return 'kept';
    if (ended) return forget(run, entry, 'ended');
  }
  // A void that passed the limit may land all the same: the next run reads it voided.
  const result = await heldTo(SERVER_LIMIT_MS, (signal) => askVoid(run.apiUrl, held, signal), {
    ok: false as const,
    kind: 'aborted' as const,
  });
  if (result.ok) return forget(run, entry, result.data?.pendingReview ? 'review' : 'voided');
  return isVerdict(result) ? refuse(run, entry, result) : 'kept';
}

async function settleAll(run: Run, matchId?: string): Promise<Map<string, Settled>> {
  const undone = (await listUndone()).filter((entry) => !matchId || entry.matchId === matchId);
  const settled = new Map<string, Settled>();
  const fresh: UndoneEntry[] = [];
  for (const entry of undone) {
    if (Date.now() - entry.undoneAt < KEPT_FOR_MS) fresh.push(entry);
    else settled.set(entry.clientUuid, await forget(run, entry, 'expired'));
  }
  for (const bout of new Set(fresh.map((entry) => entry.matchId))) {
    const read = await readServerEntries(run.apiUrl, bout);
    for (const entry of fresh.filter((row) => row.matchId === bout)) {
      settled.set(entry.clientUuid, await settleOne(run, entry, read));
    }
  }
  // Housekeeping (ruling 370): a store that refuses it stops no undo being settled.
  await dropUnreadNotices().catch((err: unknown) => {
    console.error('[undo] the notices nobody read could not be removed', err);
  });
  return settled;
}

let turn: Promise<unknown> = Promise.resolve();

const told = new Set<() => void>();

/**
 * Told after every run, whoever asked for it: the screen's watcher, or a tap on
 * Undo. A run can write a notice for the bout on screen (rulings 364 to 366):
 * told by its watcher alone, the screen showed that of a tap's run up to 15
 * seconds late. Answers its stop.
 */
export function onSettleRan(ran: () => void): () => void {
  told.add(ran);
  return () => void told.delete(ran);
}

/**
 * Ask the server for every entry the undo took off the tablet (ruling 350),
 * of one bout or of all: one it holds is voided there, by whoever is signed
 * in now. With nothing written down, nothing is asked. `tapped` is the entry
 * whose answer this run hands to the referee's button: it writes no notice.
 *
 * The race is two runs over one entry (the undo's own, the watcher's): the
 * second would void a voided row. One run at a time: the later one reads what
 * the earlier one left.
 */
export function settleUndone(
  apiUrl: string,
  matchId?: string,
  tapped?: string,
): Promise<Map<string, Settled>> {
  const run = turn.then(() => settleAll({ apiUrl, tapped, ended: new Map() }, matchId));
  turn = run.catch(() => undefined);
  // Beside the chain of runs, not in it: a listener's fault ends no later run.
  void turn.then(() => told.forEach((ran) => ran()));
  return run;
}
