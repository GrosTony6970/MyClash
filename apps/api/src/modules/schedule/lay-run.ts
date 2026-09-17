/**
 * Laying out one run of bouts from a start, for the run window's save (ADR-018).
 *
 * Pure: no database, no Nest. The service reads the rows, the lengths and the
 * sheet's gap, and hands what this returns to the placement owner, which checks
 * the pistes and writes.
 *
 * A run spanning several Lices is several queues, not one: each Lice is laid on
 * its own from the run's start, in the order its bouts already run — the rule
 * `respaceBlockSlots` follows on the grid. Two bouts starting at the same instant
 * are ordered by id, so the same rows always lay out the same way.
 *
 * A Pool's fighters meet each other, so they need a rest; the operator's rule
 * (2026-09-17) is ONE break in the middle of each piste's queue rather than the
 * scheduler's idle gap after every appearance. `midRestMs` carries it, and the
 * caller decides when it applies: a Pool, and only when the Event's sheet asks
 * for a rest. A Swiss or bracket round runs back to back — a fighter appears at
 * most once in it.
 *
 * The break is a pause for the crew as much as for the fighters: on a long Pool
 * the referee stands through every bout. The draw already spaces the fighters —
 * a Berger round-robin puts a repeated fighter in two neighbouring bouts only in
 * a Pool of three, four or five. In those three the gap alone separates them,
 * which the operator accepted; ADR-018 says why.
 */

/** A placed bout of the run, as it sits now. */
export interface RunBout {
  id: string;
  liceId: string;
  /** Its current start, in epoch ms. Decides its place in its Lice's queue. */
  startMs: number;
}

/** A bout of the run with the length it is laid at. */
export interface SizedRunBout extends RunBout {
  lengthMinutes: number;
}

/** Where a bout goes. */
export interface LaidBout {
  id: string;
  liceId: string;
  scheduledAt: string;
}

function byStartThenId(a: RunBout, b: RunBout): number {
  return a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Every bout re-laid from `startMs`. On each Lice the first bout starts at
 * `startMs` and each next one at the previous start plus the previous bout's
 * length plus the gap. Real minutes and milliseconds throughout: nothing is
 * rounded to a grid slot.
 *
 * `midRestMs` (0 for none) is added once per piste, after the first half of its
 * bouts, rounded down — fifteen bouts break after the seventh, six after the
 * third. It lands on top of that bout's gap, so the idle is the two together. A
 * piste with one bout has no middle, so it takes no break.
 */
export function layRun(args: {
  bouts: readonly SizedRunBout[];
  startMs: number;
  gapMs: number;
  midRestMs?: number;
}): LaidBout[] {
  const queues = new Map<string, SizedRunBout[]>();
  for (const bout of args.bouts) {
    const queue = queues.get(bout.liceId) ?? [];
    queue.push(bout);
    queues.set(bout.liceId, queue);
  }
  const laid: LaidBout[] = [];
  for (const [liceId, queue] of queues) {
    const restAfter = Math.floor(queue.length / 2);
    let atMs = args.startMs;
    let placed = 0;
    for (const bout of [...queue].sort(byStartThenId)) {
      laid.push({ id: bout.id, liceId, scheduledAt: new Date(atMs).toISOString() });
      placed += 1;
      atMs += bout.lengthMinutes * 60_000 + args.gapMs;
      if (placed === restAfter) atMs += args.midRestMs ?? 0;
    }
  }
  return laid;
}

/**
 * Every bout moved by one amount, so the run's earliest start lands on `startMs`.
 * The spacing between bouts is kept to the millisecond and nothing is snapped to
 * a slot. A run that is already there moves nothing, so the caller writes nothing.
 */
export function shiftRun(args: { bouts: readonly RunBout[]; startMs: number }): LaidBout[] {
  if (args.bouts.length === 0) return [];
  const earliest = Math.min(...args.bouts.map((bout) => bout.startMs));
  const deltaMs = args.startMs - earliest;
  if (deltaMs === 0) return [];
  return args.bouts.map((bout) => ({
    id: bout.id,
    liceId: bout.liceId,
    scheduledAt: new Date(bout.startMs + deltaMs).toISOString(),
  }));
}
