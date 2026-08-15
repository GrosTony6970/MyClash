import { describe, expect, it } from 'vitest';
import { DRIFT_NOTICE_MIN, previewDayDelay, suggestDayDelay } from './day-delay';
import type { LiceDrift } from './lice-drift';

const names = new Map([
  ['l1', 'Piste 1'],
  ['l2', 'Piste 2'],
  ['l3', 'Piste 3'],
]);

function drift(entries: Array<[string, number, string]>): Map<string, LiceDrift> {
  return new Map(entries.map(([id, driftMin, basisLabel]) => [id, { driftMin, basisLabel }]));
}

describe('suggestDayDelay', () => {
  /**
   * The worst piste, not the average. A day is as late as the piste furthest
   * behind — the others are waiting on it — and an average understates the
   * delay in exactly the case the control exists for.
   */
  it('suggests the worst late piste', () => {
    const seed = suggestDayDelay(
      drift([
        ['l1', 5, 'LSW-P1-3'],
        ['l2', 45, 'LSW-P2-7'],
        ['l3', 20, 'LSW-P3-1'],
      ]),
      names,
    );

    expect(seed).toEqual({ deltaMin: 45, liceName: 'Piste 2', basisLabel: 'LSW-P2-7' });
  });

  it('ignores pistes running early', () => {
    const seed = suggestDayDelay(
      drift([
        ['l1', -30, 'LSW-P1-3'],
        ['l2', 10, 'LSW-P2-7'],
      ]),
      names,
    );

    expect(seed?.deltaMin).toBe(10);
  });

  /** The same two-minute floor the piste column headers use. */
  it('suggests nothing when every piste is inside the notice threshold', () => {
    expect(suggestDayDelay(drift([['l1', DRIFT_NOTICE_MIN - 1, 'M1']]), names)).toBeNull();
    expect(suggestDayDelay(drift([]), names)).toBeNull();
  });

  it('takes the threshold itself as late enough to offer', () => {
    expect(suggestDayDelay(drift([['l1', DRIFT_NOTICE_MIN, 'M1']]), names)?.deltaMin).toBe(
      DRIFT_NOTICE_MIN,
    );
  });

  /** A piste the board knows a drift for but no name: the number still stands. */
  it('still suggests when the piste has no name to show', () => {
    expect(suggestDayDelay(drift([['unknown', 15, 'M1']]), names)).toEqual({
      deltaMin: 15,
      liceName: '',
      basisLabel: 'M1',
    });
  });
});

describe('previewDayDelay', () => {
  it('counts the bars and fights at or after the cut', () => {
    const preview = previewDayDelay({
      fromMin: 14 * 60,
      barStartMins: [12 * 60, 14 * 60, 16 * 60],
      fights: [
        { startMin: 13 * 60, status: 'scheduled' },
        { startMin: 14 * 60, status: 'scheduled' },
        { startMin: 15 * 60, status: 'scheduled' },
      ],
    });

    expect(preview).toEqual({ bars: 2, fights: 2 });
  });

  /**
   * The count has to say the same thing the write will do, or the dialog
   * promises to move fights that the API then leaves alone.
   */
  it('does not count a fight that has already begun or finished', () => {
    const preview = previewDayDelay({
      fromMin: 14 * 60,
      barStartMins: [],
      fights: [
        { startMin: 15 * 60, status: 'running' },
        { startMin: 15 * 60, status: 'paused' },
        { startMin: 15 * 60, status: 'completed' },
        { startMin: 15 * 60, status: 'voided' },
        { startMin: 15 * 60, status: 'scheduled' },
      ],
    });

    expect(preview.fights).toBe(1);
  });

  /** A bar has no status, which is exactly why the cut exists for it. */
  it('counts every bar from the cut, having nothing else to go on', () => {
    expect(previewDayDelay({ fromMin: 0, barStartMins: [0, 60, 120], fights: [] }).bars).toBe(3);
  });
});
