// Pure schedule-model helpers for the /me Schedule view (no React / i18n), kept
// separate from ScheduleView so the risky algorithms — folding per-match referee
// slots into one card per assignment, and splitting a day into segments at
// programme-break boundaries — are unit-testable in isolation.

import { fightWindow } from './conflicts';
import type { RefereeSlot, ScheduleMatch } from './types';

/** One referee card per pool / bracket-tier assignment (the many per-match
 *  referee_assignments folded together with a match count + time window). */
export interface RefereeAggregate {
  key: string;
  tournamentName: string | null;
  tournamentSlug: string | null;
  poolName: string | null;
  matchKind: string | null;
  roundOfCount: number | null;
  /** Which Swiss round this card covers. Null for every other kind. */
  swissRound: number | null;
  liceName: string | null;
  skillName: string | null;
  skillColor: string | null;
  count: number;
  startIso: string | null;
  startMs: number | null;
  endMs: number | null;
}

export const BRACKET_KINDS = new Set([
  'play_in',
  'final',
  'semi_final',
  'quarter_final',
  'round_of',
]);

/** Stable key grouping per-match referee slots into one assignment: pool matches
 *  by pool, bracket matches by tier (round), swiss by ROUND.
 *
 *  Swiss used to key on the tournament alone, which folded every round a person
 *  refereed into a single card — five separate duties spread across a day,
 *  rendered as one entry with one time window. A Swiss round is the unit the
 *  referee board assigns, so it is the unit the schedule shows. */
export function refereeAssignmentKey(s: RefereeSlot): string {
  const tn = s.tournamentName ?? '';
  if (BRACKET_KINDS.has(s.matchKind ?? '')) {
    return `r|${tn}|round:${s.matchKind}:${s.roundOfCount ?? ''}`;
  }
  if (s.matchKind === 'swiss') return `r|${tn}|swiss:${s.swissRound ?? ''}`;
  if (s.poolId) return `r|${tn}|pool:${s.poolId}`;
  return `r|${tn}|other:${s.poolName ?? s.matchId}`;
}

export function aggregateReferee(slots: RefereeSlot[]): RefereeAggregate[] {
  const map = new Map<string, RefereeSlot[]>();
  for (const s of slots) {
    const key = refereeAssignmentKey(s);
    const group = map.get(key);
    if (group) group.push(s);
    else map.set(key, [s]);
  }
  return [...map.entries()].map(([key, group]) => {
    const base = group[0]!;
    // The window the API works out from the Matches each duty covers: its own
    // Match, or its Pool's placed Matches (ADR-017). The start falls back to the
    // Match's own time, the key the API sorts by: a start needs no length, so a
    // placed duty keeps it when the API could not work its window out. The end
    // has no fallback. A duty whose end the API does not know has none here.
    const ms = (iso: string | null): number => (iso ? new Date(iso).getTime() : NaN);
    const starts = group
      .map((s) => ms(s.scheduledAt ?? s.startsAt))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    const ends = group
      .map((s) => ms(s.endsAt))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    const startMs = starts.length ? starts[0]! : null;
    const endMs = ends.length ? ends[ends.length - 1]! : null;
    return {
      key,
      tournamentName: base.tournamentName,
      tournamentSlug: base.tournamentSlug,
      poolName: base.poolName,
      matchKind: base.matchKind,
      roundOfCount: base.roundOfCount,
      swissRound: base.swissRound,
      liceName: group.find((s) => s.liceName)?.liceName ?? null,
      skillName: base.skillName,
      skillColor: base.skillColor,
      // Whole-pool roles (Déclarant) fold to one slot but cover the pool's whole
      // bout count; per-match assignments count their own rows.
      count: group.find((s) => s.poolMatchCount != null)?.poolMatchCount ?? group.length,
      startIso: startMs != null ? new Date(startMs).toISOString() : null,
      startMs,
      endMs,
    };
  });
}

/**
 * Where a fight group's header ends, as far as one bout is concerned: the later
 * of the bout's own planned end and its programme block's end (operator ruling,
 * 2026-09-17). The block says when the phase is planned to be over; a bout moved
 * past it still ends when it ends, and a header that stops before a real bout is
 * wrong. A bout whose length is unknown counts as ending at its start.
 */
export function fightHeaderEnd(
  match: Pick<ScheduleMatch, 'scheduledAt' | 'durationMinutes'>,
  blockEndMs: number | null,
): number | null {
  const startMs = match.scheduledAt ? Date.parse(match.scheduledAt) : NaN;
  const ownEndMs = fightWindow(match)?.endMs ?? startMs;
  if (Number.isNaN(ownEndMs)) return blockEndMs;
  return blockEndMs == null ? ownEndMs : Math.max(ownEndMs, blockEndMs);
}

/** A day rendered as a chronological run of programme bars (hard dividers) and
 *  segments (break-free spans of commitments). A weapon that straddles a break
 *  therefore lands in a segment on either side of the bar. */
export type DaySlice<TItem, TBar> =
  { type: 'bar'; bar: TBar } | { type: 'segment'; index: number; items: TItem[] };

/** Interleave timed items with programme bars by start time, then split the item
 *  stream into segments wherever a bar falls. Bars sort before items at an equal
 *  instant so a break renders above the commitments that start with it. */
export function partitionAtBars<TItem, TBar>(
  items: Array<{ item: TItem; sort: number }>,
  bars: Array<{ bar: TBar; sort: number }>,
): DaySlice<TItem, TBar>[] {
  type Entry =
    { kind: 'bar'; sort: number; bar: TBar } | { kind: 'item'; sort: number; item: TItem };
  const entries: Entry[] = [
    ...bars.map((b): Entry => ({ kind: 'bar', sort: b.sort, bar: b.bar })),
    ...items.map((it): Entry => ({ kind: 'item', sort: it.sort, item: it.item })),
  ].sort((a, b) => a.sort - b.sort || (a.kind === b.kind ? 0 : a.kind === 'bar' ? -1 : 1));

  const slices: DaySlice<TItem, TBar>[] = [];
  let cur: TItem[] = [];
  let index = 0;
  const flush = () => {
    if (cur.length) {
      slices.push({ type: 'segment', index: index++, items: cur });
      cur = [];
    }
  };
  for (const e of entries) {
    if (e.kind === 'bar') {
      flush();
      slices.push({ type: 'bar', bar: e.bar });
    } else {
      cur.push(e.item);
    }
  }
  flush();
  return slices;
}
