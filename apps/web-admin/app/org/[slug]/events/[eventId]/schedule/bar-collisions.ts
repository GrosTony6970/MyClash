/**
 * Fights sitting inside a break or admin bar.
 *
 * NEITHER view enforced this. The Blocks view tints its drag ghost red when a
 * drop would land on a bar, and then its drop handler ignores the tint and
 * places the fight anyway; the Detailed view never checked at all. So a bout
 * could be scheduled inside the lunch break, or on top of the referee meeting,
 * with the board showing nothing wrong once the drag ended.
 *
 * This WARNS rather than blocks, by decision: an organiser running late does
 * sometimes push a bout through a nominal break to catch up, and refusing the
 * placement would fight them. It reads like the fighter double-booking banner
 * beside it — a thing to notice, not a wall.
 *
 * Bars span every lice, so a bar collision is purely a question of time.
 *
 * Pure: no React, no I/O.
 */

export interface BarWindow {
  id: string;
  label: string;
  /** Inclusive first slot, and the slot count. Same axis as the grid. */
  startSlot: number;
  span: number;
}

export interface PlacedMatch {
  id: string;
  matchNumberLabel: string;
  startSlot: number;
  /** Slot count; a match shorter than one slot still occupies one. */
  span: number;
}

export interface BarCollision {
  matchId: string;
  matchLabel: string;
  barId: string;
  barLabel: string;
}

/** True when [aStart, aEnd) and [bStart, bEnd) intersect. Touching is fine. */
function overlaps(aStart: number, aSpan: number, bStart: number, bSpan: number): boolean {
  return aStart < bStart + bSpan && bStart < aStart + aSpan;
}

/**
 * Every (match, bar) pair whose times intersect. A match landing across two
 * bars reports once per bar — the operator is told the whole truth rather than
 * the first half of it.
 */
export function detectBarCollisions(
  matches: readonly PlacedMatch[],
  bars: readonly BarWindow[],
): BarCollision[] {
  if (bars.length === 0 || matches.length === 0) return [];
  const out: BarCollision[] = [];
  for (const match of matches) {
    for (const bar of bars) {
      if (
        !overlaps(match.startSlot, Math.max(1, match.span), bar.startSlot, Math.max(1, bar.span))
      ) {
        continue;
      }
      out.push({
        matchId: match.id,
        matchLabel: match.matchNumberLabel,
        barId: bar.id,
        barLabel: bar.label,
      });
    }
  }
  return out;
}
