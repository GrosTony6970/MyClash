// Time-overlap conflict detection shared by the Schedule view, the Workshops tab
// and the event's own my-schedule page. Two commitments conflict when their
// windows overlap at all, half-open, by the one rule in `@myclash/schedule-core`.
//
// A window needs a real end. A bout's planned length and a duty's end come from
// the API (ADR-018); an item whose end is unknown has no window and takes no part
// in the check. This file used to add five minutes to every start, and a guessed
// length is what the Event's planner sheet replaced.
//
// A fighter is busy for a whole block, not only their own bouts: their Pool
// (operator, 2026-09-17), their Swiss phase, and their elimination bracket until
// they are out (operator, 2026-11-23). The block's span — its first placed bout
// to the end of its last, whoever fights them, and for a Pool no earlier than the
// end of its programme bar (operator, 2026-11-27); the API works it out — is a
// commitment too, and clashes like any other.
//
// A clash names the block, never the person: "Pool 1 · Longsword Open",
// "Elimination · Longsword Open", "Swiss · Longsword Open" (operator, 2026-11-23).

import { matchWindowMs, overlapsHalfOpen, type TimeWindowMs } from '@myclash/schedule-core';
import type { PhaseSpan, PoolSpan, RefereeSlot, ScheduleMatch, WorkshopEnrollment } from './types';

/** The words a block name needs: plain keys, no values. Every page's translator is one. */
type Words = (key: string) => string;

export interface TimedItem extends TimeWindowMs {
  key: string;
  label: string;
  /** On a bout: the block it belongs to (`blockKeyOf`). */
  blockOf?: string;
  /** On a block's span: the block it spans. */
  spanOf?: string;
}

/**
 * A block's span never clashes with its own bouts, which it covers by definition.
 * Two bouts of one block still can: a Pool may run on two pistes at once.
 */
const covers = (span: TimedItem, bout: TimedItem): boolean =>
  span.spanOf !== undefined && span.spanOf === bout.blockOf;

/**
 * Map of item key → labels of the items it conflicts with (bidirectional). Each label once:
 * a block's span and one of its bouts both meet a Workshop that overlaps that bout.
 */
export function detectConflicts(items: TimedItem[]): Map<string, string[]> {
  const conflicts = new Map<string, string[]>();
  const add = (key: string, label: string) => {
    const list = conflicts.get(key) ?? [];
    if (!list.includes(label)) conflicts.set(key, [...list, label]);
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!a || !b) continue;
      if (covers(a, b) || covers(b, a)) continue;
      if (overlapsHalfOpen(a, b)) {
        add(a.key, b.label);
        add(b.key, a.label);
      }
    }
  }
  return conflicts;
}

/** A commitment with a readable start AND end, or null: no end, no window. */
export function toTimed(
  key: string,
  label: string,
  startIso: string | null,
  endIso: string | null,
): TimedItem | null {
  if (!startIso || !endIso) return null;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return { key, label, startMs, endMs };
}

/**
 * A booked Workshop session's window, or null: no readable start and end, or a cancelled session.
 * A cancelled one will not run, so it is no clash (ruling 529). One owner for both schedule pages.
 */
export function workshopTimed(
  key: string,
  label: string,
  workshop: Pick<WorkshopEnrollment, 'sessionStart' | 'sessionEnd' | 'sessionCancelled'>,
): TimedItem | null {
  if (workshop.sessionCancelled) return null;
  return toTimed(key, label, workshop.sessionStart, workshop.sessionEnd);
}

/**
 * A bout's planned window: its start plus its planned length. The API sends no
 * length when it cannot read the Event's sheet — then the bout ends where the API
 * fell back on, at its next bout (operator, 2026-09-18), or has no window when
 * nothing follows it. A schedule cached before the API sent a length has no such
 * field at all; `matchWindowMs` throws on both, and here it would throw during
 * render.
 */
export function fightWindow(
  match: Pick<ScheduleMatch, 'scheduledAt' | 'durationMinutes' | 'fallbackEndsAt'>,
): TimeWindowMs | null {
  const { scheduledAt, durationMinutes } = match;
  if (!scheduledAt || !Number.isFinite(Date.parse(scheduledAt))) return null;
  if (durationMinutes == null) {
    const startMs = Date.parse(scheduledAt);
    const endMs = match.fallbackEndsAt ? Date.parse(match.fallbackEndsAt) : NaN;
    // False for an end it cannot read, too: NaN is after nothing.
    return endMs > startMs ? { startMs, endMs } : null;
  }
  if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes)) return null;
  if (durationMinutes <= 0) return null;
  return matchWindowMs(scheduledAt, durationMinutes);
}

/**
 * How many of a page's cards have a start and no window: commitments the clash
 * check cannot see, which the page says in one line (operator, 2026-09-18). A
 * card is what the page shows — a Pool span is none, and an unplaced card has
 * no time to clash at.
 */
export function uncheckedCount(
  cards: ReadonlyArray<{ key: string; time: string | null }>,
  timed: readonly TimedItem[],
): number {
  const checked = new Set(timed.map((item) => item.key));
  return cards.filter((card) => card.time !== null && !checked.has(card.key)).length;
}

/** What the functions below need of a bout. Each page keeps its own bout type. */
type Bout = Pick<
  ScheduleMatch,
  | 'id'
  | 'scheduledAt'
  | 'durationMinutes'
  | 'fallbackEndsAt'
  | 'poolId'
  | 'phaseId'
  | 'phase'
  | 'poolName'
  | 'tournamentName'
  | 'roundCode'
>;

const poolSpanKey = (poolId: string): string => `pool-${poolId}`;
const phaseSpanKey = (phaseId: string): string => `phase-${phaseId}`;

/**
 * The block a bout belongs to, as its span's key: its Pool, or its bracket or Swiss phase.
 * Undefined when the bout names neither (a copy cached before the API sent them).
 */
function blockKeyOf(match: Bout): string | undefined {
  if (match.poolId) return poolSpanKey(match.poolId);
  if ((match.phase === 'bracket' || match.phase === 'swiss') && match.phaseId) {
    return phaseSpanKey(match.phaseId);
  }
  return undefined;
}

/** "Elimination" or "Swiss": the name of a phase block, in the reader's language. */
function phaseWord(t: Words, kind: 'bracket' | 'swiss'): string {
  return kind === 'bracket'
    ? t('publicApp.me.schedule.eliminationBlock')
    : t('publicApp.me.hub.kindSwiss');
}

/**
 * What a clash calls a bout: its block and Tournament ("Pool 1 · Longsword Open", "Elimination ·
 * Longsword Open"), never the opponent (operator, 2026-11-23). The bout's code stands in for a
 * block it cannot name.
 */
export function blockLabel(t: Words, match: Bout): string {
  const block =
    match.phase === 'pool' || (match.phase == null && match.poolName)
      ? match.poolName
      : match.phase === 'bracket' || match.phase === 'swiss'
        ? phaseWord(t, match.phase)
        : null;
  return [block || match.roundCode, match.tournamentName].filter(Boolean).join(' · ');
}

/**
 * A fighter's block spans AND their bouts, as timed items — together, because they come from
 * the same bouts, and a page that took the bouts without the spans would drop the whole-block
 * rule in silence. The spans come first: a Workshop clash names the first item it meets, and a
 * session that meets one bout of a block meets the block too, which names it with its whole
 * window. A bout with no window is left out; its block's span still takes part. Each page names
 * its own bout keys; every page names a bout by its block (`blockLabel`).
 *
 * `poolSpans` and `phaseSpans` are absent in a schedule cached before the API sent them: the
 * /me pages paint that copy first, and nothing validates it.
 */
export function fightItems<M extends Bout>(
  schedule: {
    matches: readonly M[];
    poolSpans?: readonly PoolSpan[];
    phaseSpans?: readonly PhaseSpan[];
  },
  boutKey: (match: M) => string,
  t: Words,
): TimedItem[] {
  const pools = (schedule.poolSpans ?? []).flatMap((span): TimedItem[] => {
    const label = [span.poolName, span.tournamentName].filter(Boolean).join(' · ');
    const key = poolSpanKey(span.poolId);
    const timed = toTimed(key, label, span.startsAt, span.endsAt);
    return timed ? [{ ...timed, spanOf: key }] : [];
  });
  const phases = (schedule.phaseSpans ?? []).flatMap((span): TimedItem[] => {
    const label = [phaseWord(t, span.kind), span.tournamentName].filter(Boolean).join(' · ');
    const key = phaseSpanKey(span.phaseId);
    const timed = toTimed(key, label, span.startsAt, span.endsAt);
    return timed ? [{ ...timed, spanOf: key }] : [];
  });
  const bouts = schedule.matches.flatMap((match): TimedItem[] => {
    const window = fightWindow(match);
    if (!window) return [];
    const label = blockLabel(t, match);
    return [{ key: boutKey(match), label, ...window, blockOf: blockKeyOf(match) }];
  });
  return [...pools, ...phases, ...bouts];
}

/**
 * A block's span has no card of its own, so what it clashes with is shown on its bout cards —
 * every one of them, a bout with no window included, since it is still in the block (operator,
 * 2026-09-18; bracket and Swiss, 2026-11-23). A bout that also clashes with the same item
 * directly lists it once.
 */
export function spreadBlockConflicts<M extends Bout>(
  conflicts: Map<string, string[]>,
  schedule: { matches: readonly M[] },
  boutKey: (match: M) => string,
): Map<string, string[]> {
  const spread = new Map(conflicts);
  for (const match of schedule.matches) {
    const block = blockKeyOf(match);
    const fromSpan = block ? conflicts.get(block) : undefined;
    if (!fromSpan) continue;
    const key = boutKey(match);
    spread.set(key, [...new Set([...(spread.get(key) ?? []), ...fromSpan])]);
  }
  return spread;
}

/**
 * A referee duty as a timed commitment: the window the API works out from the
 * Matches the duty covers, its own Match or its Pool's placed Matches (ADR-017).
 * A Pool duty has no Match time of its own, so this is the only window it has.
 * Null when the API does not know the duty's end.
 */
export function dutyTimed(
  key: string,
  label: string,
  duty: Pick<RefereeSlot, 'startsAt' | 'endsAt'>,
): TimedItem | null {
  return toTimed(key, label, duty.startsAt, duty.endsAt);
}
