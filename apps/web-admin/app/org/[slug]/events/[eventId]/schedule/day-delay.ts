import type { LiceDrift } from './lice-drift';

/**
 * What "we are running late" means for a whole day, and what pressing it moves.
 *
 * The board already measures drift PER PISTE and offers a "+N" that pushes that
 * piste's fights. What it never did was move the programme bars, so a delayed
 * day kept its lunch bar sitting on top of the fights that had been pushed past
 * it, and the plan lost its shape one piste at a time. The whole-day control
 * moves bars and fights together.
 *
 * A day has no single measured drift — `computeLiceDrift` returns one per
 * piste. `suggestDayDelay` picks the number to open the dialog with, and
 * `previewDayDelay` says what pressing it will touch.
 *
 * Pure: no React, no fetch, no clock. Minutes and counts in, minutes and counts
 * out.
 */

/**
 * Ignore drift under two minutes, exactly as the piste column headers do.
 *
 * The same threshold in two places would be two thresholds; this is the one,
 * and `BlockGridView` should read it rather than repeat the literal.
 */
export const DRIFT_NOTICE_MIN = 2;

/** The one bout state a delay may retime — the API applies the same rule. */
const MOVABLE_STATUS = 'scheduled';

export interface DayDelaySeed {
  /** Minutes to open the dialog with. Always positive: this control pushes back. */
  deltaMin: number;
  /** The piste that number came from, for the sentence explaining it. */
  liceName: string;
  /** The bout the drift was measured against. */
  basisLabel: string;
}

/**
 * The delay to suggest for the day: the worst late piste.
 *
 * The worst rather than the average, because a day is as late as the piste
 * furthest behind — every other piste is waiting on it for referees, for the
 * next round's fighters, or simply for the operator's attention. An average
 * would understate the delay in exactly the case the control exists for.
 *
 * Null when nothing is meaningfully late, which is how the caller decides
 * whether to show the control at all.
 */
export function suggestDayDelay(
  drift: ReadonlyMap<string, LiceDrift>,
  liceNameById: ReadonlyMap<string, string>,
): DayDelaySeed | null {
  let worst: DayDelaySeed | null = null;
  for (const [liceId, d] of drift) {
    if (d.driftMin < DRIFT_NOTICE_MIN) continue; // early or on time
    if (worst && d.driftMin <= worst.deltaMin) continue;
    worst = {
      deltaMin: d.driftMin,
      liceName: liceNameById.get(liceId) ?? '',
      basisLabel: d.basisLabel,
    };
  }
  return worst;
}

export interface DayDelayPreview {
  bars: number;
  fights: number;
}

/**
 * How many bars and fights the delay will move.
 *
 * A count, not a decision — the API plans and writes, and refuses the whole
 * thing if any of it would cross midnight. This exists so an operator is not
 * asked to confirm a day-wide write with no idea of its size. It applies the
 * same two rules the API does, so the two must be changed together; the API is
 * the authority when they ever disagree.
 */
export function previewDayDelay(input: {
  /** Minute of the day the delay starts from. */
  fromMin: number;
  /** Every bar on the day, by start minute. */
  barStartMins: readonly number[];
  /** Every bout on the day, with the minute it is planned for. */
  fights: ReadonlyArray<{ startMin: number; status: string }>;
}): DayDelayPreview {
  return {
    bars: input.barStartMins.filter((startMin) => startMin >= input.fromMin).length,
    fights: input.fights.filter((f) => f.status === MOVABLE_STATUS && f.startMin >= input.fromMin)
      .length,
  };
}
