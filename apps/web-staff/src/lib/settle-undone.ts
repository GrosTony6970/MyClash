import type { ApiFailure } from '@myclash/api-client';
import type { UndoneEntry } from '../offline/db';
import { forgetUndone, listUndone } from '../offline/undone';
import { readServerEntries, type ServerRead } from './server-entries';
import { heldTo, SERVER_LIMIT_MS } from './time-limit';
import { askVoid } from './void-entry';

/**
 * What became of one entry the undo took off the tablet. `voided`: the server
 * held it and it is voided there. `review`: the Event is over, a request was
 * filed. `absent`: the server holds no live entry of that id. `kept`: the
 * server could not be asked, it is tried again. `refused`: the server judged
 * the request and said no, about an entry of the bout `matchId` (ruling 354:
 * that bout's screen says it). `expired`: nobody could ask for a day.
 */
export type Settled =
  'voided' | 'review' | 'absent' | 'kept' | 'expired' | { refused: ApiFailure; matchId: string };

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

/** Nobody who may score the bout came back to the tablet: the undo is let go. */
const KEPT_FOR_MS = 24 * 60 * 60 * 1000;

async function forget(entry: UndoneEntry, settled: Settled): Promise<Settled> {
  if (settled === 'expired' || typeof settled === 'object') {
    console.warn('[undo] an undo taken on the tablet was not settled with the server', {
      entry,
      settled,
    });
  }
  await forgetUndone(entry.clientUuid);
  return settled;
}

const refuse = (entry: UndoneEntry, refused: ApiFailure) =>
  forget(entry, { refused, matchId: entry.matchId });

async function settleOne(apiUrl: string, entry: UndoneEntry, read: ServerRead): Promise<Settled> {
  if ('failure' in read) {
    return isVerdict(read.failure) ? refuse(entry, read.failure) : 'kept';
  }
  const held = read.rows.find((row) => row.clientUuid === entry.clientUuid && !row.voided);
  if (!held) return forget(entry, 'absent');
  // A void that passed the limit may land all the same: the next run reads it voided.
  const result = await heldTo(SERVER_LIMIT_MS, (signal) => askVoid(apiUrl, held, signal), {
    ok: false as const,
    kind: 'aborted' as const,
  });
  if (result.ok) return forget(entry, result.data?.pendingReview ? 'review' : 'voided');
  return isVerdict(result) ? refuse(entry, result) : 'kept';
}

async function settleAll(apiUrl: string, matchId?: string): Promise<Map<string, Settled>> {
  const undone = (await listUndone()).filter((entry) => !matchId || entry.matchId === matchId);
  const settled = new Map<string, Settled>();
  const fresh: UndoneEntry[] = [];
  for (const entry of undone) {
    if (Date.now() - entry.undoneAt < KEPT_FOR_MS) fresh.push(entry);
    else settled.set(entry.clientUuid, await forget(entry, 'expired'));
  }
  for (const bout of new Set(fresh.map((entry) => entry.matchId))) {
    const read = await readServerEntries(apiUrl, bout);
    for (const entry of fresh.filter((row) => row.matchId === bout)) {
      settled.set(entry.clientUuid, await settleOne(apiUrl, entry, read));
    }
  }
  return settled;
}

let turn: Promise<unknown> = Promise.resolve();

/**
 * Ask the server for every entry the undo took off the tablet (ruling 350),
 * of one bout or of all: one it holds is voided there, by whoever is signed
 * in now. With nothing written down, nothing is asked.
 *
 * The race is two runs over one entry (the undo's own, the watcher's): the
 * second would void a voided row. One run at a time: the later one reads what
 * the earlier one left.
 */
export function settleUndone(apiUrl: string, matchId?: string): Promise<Map<string, Settled>> {
  const run = turn.then(() => settleAll(apiUrl, matchId));
  turn = run.catch(() => undefined);
  return run;
}
