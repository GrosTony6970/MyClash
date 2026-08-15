import { describe, expect, it } from 'vitest';
import { planDayDelay, type MoveCandidateMatch, type MoveDayBlock } from './block-move-plan';

/**
 * The whole-day running-late control, split from `block-move-plan.test.ts` when
 * the two suites together crossed the 400-line file cap.
 *
 * They belong apart rather than merged: `planBlockMove` and `planDayDelay` are
 * the module's two entry points, and the rules they SHARE (the status
 * allowlist, the midnight refusal) are proved against the bar drag next door.
 * What is here is what the day delay does that a bar drag does not.
 *
 * The helpers are duplicated on purpose. They are four lines, and a fixture
 * module shared between two suites is a thing that grows a personality.
 */
const at = (y: number, m: number, d: number, hh: number, mm: number): string =>
  new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();

const DAY = '2026-06-02';

function bar(id: string, label: string, startMin: number, endMin: number): MoveDayBlock {
  return { id, label, startMin, endMin };
}

function bout(id: string, scheduledAt: string | null, status = 'scheduled'): MoveCandidateMatch {
  return { id, phaseId: 'phase-1', scheduledAt, status, label: null };
}

/**
 * The whole-day control. No bar is dragged, so the cut is the clock — and the
 * bars are the reason the cut exists at all: a bar carries no status to say it
 * has already happened, while a bout does.
 */
describe('planDayDelay', () => {
  const delay = (over: {
    deltaMin?: number;
    fromMin?: number;
    dayBlocks?: MoveDayBlock[];
    matches?: MoveCandidateMatch[];
  }) =>
    planDayDelay({
      deltaMin: over.deltaMin ?? 20,
      fromMin: over.fromMin ?? 14 * 60,
      blockDateIso: DAY,
      dayBlocks: over.dayBlocks ?? [],
      matches: over.matches ?? [],
    });

  it('moves every bar and every waiting bout at or after the cut', () => {
    const plan = delay({
      dayBlocks: [
        bar('lunch', 'Lunch', 12 * 60, 13 * 60),
        bar('finals', 'Finals', 16 * 60, 17 * 60),
      ],
      matches: [
        bout('earlier', at(2026, 6, 2, 13, 30)),
        bout('at-the-cut', at(2026, 6, 2, 14, 0)),
        bout('later', at(2026, 6, 2, 16, 30)),
      ],
    });

    expect(plan.refusal).toBeNull();
    // Lunch is before the cut and stays; Finals follows.
    expect(plan.blockShifts).toEqual([
      { id: 'finals', startMin: 16 * 60 + 20, endMin: 17 * 60 + 20 },
    ]);
    expect(plan.matchShifts.map((s) => s.id)).toEqual(['at-the-cut', 'later']);
  });

  /**
   * THE POINT OF THE SLICE. The per-piste "+N" the board already had moves that
   * piste's fights and nothing else — the lunch bar and the finals bar stayed
   * where they were, so the plan lost its shape one piste at a time. A bar
   * moving with the fights is what this adds.
   */
  it('moves the bars, which the per-piste control never did', () => {
    const plan = delay({
      dayBlocks: [bar('finals', 'Finals', 16 * 60, 17 * 60)],
      matches: [bout('m1', at(2026, 6, 2, 16, 30))],
    });

    expect(plan.blockShifts).toHaveLength(1);
    expect(plan.matchShifts).toHaveLength(1);
  });

  it('leaves a bout that has already begun where it is', () => {
    const plan = delay({
      matches: [
        bout('on-the-piste', at(2026, 6, 2, 14, 30), 'running'),
        bout('waiting', at(2026, 6, 2, 15, 0)),
      ],
    });

    expect(plan.matchShifts.map((s) => s.id)).toEqual(['waiting']);
  });

  it('refuses the whole delay when it would push the day past midnight', () => {
    const plan = delay({
      deltaMin: 90,
      dayBlocks: [bar('finals', 'Finals', 22 * 60, 23 * 60)],
      matches: [bout('m1', at(2026, 6, 2, 22, 30))],
    });

    expect(plan.refusal).toBe(
      'Pushing the day back by +90 min would carry the bar "Finals" past midnight ' +
        '(23:00 becomes 00:30). Nothing was moved.',
    );
    expect(plan.matchShifts).toEqual([]);
    expect(plan.blockShifts).toEqual([]);
  });

  it('plans nothing for a zero delay', () => {
    const plan = delay({
      deltaMin: 0,
      dayBlocks: [bar('finals', 'Finals', 16 * 60, 17 * 60)],
      matches: [bout('m1', at(2026, 6, 2, 16, 30))],
    });

    expect(plan.refusal).toBeNull();
    expect(plan.blockShifts).toEqual([]);
    expect(plan.matchShifts.map((s) => s.scheduledAt)).toEqual([at(2026, 6, 2, 16, 30)]);
  });
});
