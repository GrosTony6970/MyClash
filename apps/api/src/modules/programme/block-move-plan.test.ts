import { describe, expect, it } from 'vitest';
import { planBlockMove, type MoveCandidateMatch, type MoveDayBlock } from './block-move-plan';

/**
 * A `scheduled_at` for a WALL-CLOCK time, built from local parts.
 *
 * Never a hard-coded `...Z` string. That quietly asserts UTC semantics and
 * passes only where the machine runs UTC — the exact shape that let `moveBlock`
 * shift nothing at all on every non-UTC deployment while its tests stayed
 * green.
 */
const at = (y: number, m: number, d: number, hh: number, mm: number): string =>
  new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();

const DAY = '2026-06-02';

function bar(id: string, label: string, startMin: number, endMin: number): MoveDayBlock {
  return { id, label, startMin, endMin };
}

function bout(
  id: string,
  scheduledAt: string | null,
  status = 'scheduled',
  label: string | null = null,
): MoveCandidateMatch {
  return { id, phaseId: 'phase-1', scheduledAt, status, label };
}

/** Bar "lunch" 12:00–13:00, dragged to 14:00. Δ = +120. */
function lunchMovedForward(overrides: {
  dayBlocks?: MoveDayBlock[];
  matches?: MoveCandidateMatch[];
  deltaMin?: number;
}) {
  return planBlockMove({
    movedBlockId: 'lunch',
    movedBlockLabel: 'Lunch',
    deltaMin: overrides.deltaMin ?? 120,
    oldStartMin: 12 * 60,
    blockDateIso: DAY,
    dayBlocks: overrides.dayBlocks ?? [bar('lunch', 'Lunch', 12 * 60, 13 * 60)],
    matches: overrides.matches ?? [],
  });
}

describe('planBlockMove — which bouts move', () => {
  it('moves a waiting bout at or after the bar, on the bar’s own day', () => {
    const plan = lunchMovedForward({
      matches: [
        bout('before', at(2026, 6, 2, 11, 30)),
        bout('on-the-boundary', at(2026, 6, 2, 12, 0)),
        bout('after', at(2026, 6, 2, 15, 0)),
        bout('other-day', at(2026, 6, 3, 15, 0)),
        bout('unscheduled', null),
      ],
    });

    expect(plan.refusal).toBeNull();
    expect(plan.matchShifts).toEqual([
      { id: 'on-the-boundary', phaseId: 'phase-1', scheduledAt: at(2026, 6, 2, 14, 0) },
      { id: 'after', phaseId: 'phase-1', scheduledAt: at(2026, 6, 2, 17, 0) },
    ]);
  });

  /**
   * THE FAULT. A bar dropped above a bout that had already been fought rewrote
   * its planned time, so the plan said one thing and the record another. Only a
   * bout still waiting to be fought moves — the allowlist `shiftLiceRemaining`
   * already uses, so the two running-late controls agree.
   */
  it.each(['running', 'paused', 'completed', 'voided'])(
    'leaves a %s bout where it is — its time is history, not plan',
    (status) => {
      const plan = lunchMovedForward({
        matches: [bout('history', at(2026, 6, 2, 15, 0), status)],
      });

      expect(plan.refusal).toBeNull();
      expect(plan.matchShifts).toEqual([]);
    },
  );

  it('sorts the bouts it moves by the clock, whatever order they were read in', () => {
    const plan = lunchMovedForward({
      matches: [
        bout('third', at(2026, 6, 2, 17, 0)),
        bout('first', at(2026, 6, 2, 12, 30)),
        bout('second', at(2026, 6, 2, 14, 0)),
      ],
    });

    expect(plan.matchShifts.map((s) => s.id)).toEqual(['first', 'second', 'third']);
  });

  /**
   * `matches.phase_id` is NOT NULL, and the batched write is an UPSERT, so
   * PostgreSQL validates the candidate INSERT row before it resolves the
   * conflict. Dropping the phase here crashes a write where every row exists.
   */
  it('carries each bout’s phase through to the write', () => {
    const plan = planBlockMove({
      movedBlockId: 'lunch',
      movedBlockLabel: 'Lunch',
      deltaMin: 30,
      oldStartMin: 12 * 60,
      blockDateIso: DAY,
      dayBlocks: [bar('lunch', 'Lunch', 12 * 60, 13 * 60)],
      matches: [
        { ...bout('m1', at(2026, 6, 2, 13, 0)), phaseId: 'phase-pools' },
        { ...bout('m2', at(2026, 6, 2, 13, 5)), phaseId: 'phase-finals' },
      ],
    });

    expect(plan.matchShifts.map((s) => s.phaseId)).toEqual(['phase-pools', 'phase-finals']);
  });
});

describe('planBlockMove — the midnight refusal', () => {
  it('refuses when a following bar’s end would pass 23:59', () => {
    const plan = lunchMovedForward({
      deltaMin: 90,
      dayBlocks: [
        bar('lunch', 'Lunch', 12 * 60, 13 * 60),
        bar('finals', 'Finals', 22 * 60, 23 * 60 + 30),
      ],
    });

    expect(plan.refusal).toBe(
      'Moving "Lunch" by +90 min would carry the bar "Finals" past midnight ' +
        '(23:30 becomes 01:00). Nothing was moved.',
    );
  });

  it('refuses when a bar would be pulled back before 00:00', () => {
    const plan = planBlockMove({
      movedBlockId: 'reg',
      movedBlockLabel: 'Registration',
      deltaMin: -90,
      oldStartMin: 60,
      blockDateIso: DAY,
      dayBlocks: [bar('reg', 'Registration', 60, 120)],
      matches: [],
    });

    expect(plan.refusal).toBe(
      'Moving "Registration" by -90 min would carry the bar "Registration" past midnight ' +
        '(01:00 becomes 23:30). Nothing was moved.',
    );
  });

  it('refuses when a bout would roll onto the next day', () => {
    const plan = lunchMovedForward({
      deltaMin: 120,
      matches: [bout('late', at(2026, 6, 2, 23, 30), 'scheduled', 'LSW-F')],
    });

    expect(plan.refusal).toBe(
      'Moving "Lunch" by +120 min would carry the fight LSW-F past midnight ' +
        '(23:30 becomes 01:30). Nothing was moved.',
    );
  });

  it('refuses when a bout would roll back onto the previous day', () => {
    const plan = planBlockMove({
      movedBlockId: 'reg',
      movedBlockLabel: 'Registration',
      deltaMin: -60,
      oldStartMin: 0,
      blockDateIso: DAY,
      // The bar itself survives the pull-back; only the bout crosses.
      dayBlocks: [bar('reg', 'Registration', 60, 120)],
      matches: [bout('early', at(2026, 6, 2, 0, 30))],
    });

    expect(plan.refusal).toBe(
      'Moving "Registration" by -60 min would carry a fight past midnight ' +
        '(00:30 becomes 23:30). Nothing was moved.',
    );
  });

  /**
   * Half a shift is the fault. A refusal that still handed back bouts to write
   * would be the same bug wearing an error message.
   */
  it('plans nothing at all when it refuses', () => {
    const plan = lunchMovedForward({
      deltaMin: 720,
      dayBlocks: [
        bar('lunch', 'Lunch', 12 * 60, 13 * 60),
        bar('finals', 'Finals', 22 * 60, 23 * 60),
      ],
      matches: [bout('m1', at(2026, 6, 2, 13, 0))],
    });

    expect(plan.refusal).not.toBeNull();
    expect(plan.matchShifts).toEqual([]);
    expect(plan.blockShifts).toEqual([]);
  });

  it('names the earliest offending bar, whatever order the rows arrived in', () => {
    const plan = lunchMovedForward({
      deltaMin: 300,
      dayBlocks: [
        bar('night', 'Night session', 23 * 60, 23 * 60 + 30),
        bar('lunch', 'Lunch', 12 * 60, 13 * 60),
        bar('evening', 'Evening session', 20 * 60, 21 * 60),
      ],
    });

    // Both "evening" (20:00 + 5h = 01:00) and "night" would cross; the sentence
    // names the one that comes first on the clock, not the first row read.
    expect(plan.refusal).toContain('the bar "Evening session"');
  });

  it('reports a crossing bar before a crossing bout', () => {
    const plan = lunchMovedForward({
      deltaMin: 300,
      dayBlocks: [
        bar('lunch', 'Lunch', 12 * 60, 13 * 60),
        bar('evening', 'Evening session', 20 * 60, 21 * 60),
      ],
      matches: [bout('late', at(2026, 6, 2, 22, 0), 'scheduled', 'LSW-F')],
    });

    expect(plan.refusal).toContain('the bar "Evening session"');
  });

  /**
   * The two rules meet here. A finished bout at 23:30 is not going anywhere, so
   * it cannot be carried past midnight and must not refuse a move that is
   * otherwise fine. Checking the crossing before the status filter would ground
   * every late-running day the moment one bout finished near the end of it.
   */
  it('is not tripped by a finished bout sitting near midnight', () => {
    const plan = lunchMovedForward({
      deltaMin: 120,
      matches: [
        bout('done', at(2026, 6, 2, 23, 30), 'completed'),
        bout('waiting', at(2026, 6, 2, 13, 0)),
      ],
    });

    expect(plan.refusal).toBeNull();
    expect(plan.matchShifts.map((s) => s.id)).toEqual(['waiting']);
  });
});

describe('planBlockMove — what the refusal buys', () => {
  /**
   * `cascadeBlockShift` clamps a backward move at 00:00 and `minToTime` clamps
   * a forward one at 23:59. Past the refusal neither clamp can fire, so the
   * bars that come back are the raw arithmetic — which is the whole reason the
   * bars and the bouts can no longer disagree.
   */
  it('returns unclamped bar shifts once the move is allowed', () => {
    const plan = planBlockMove({
      movedBlockId: 'reg',
      movedBlockLabel: 'Registration',
      deltaMin: -60,
      oldStartMin: 8 * 60,
      blockDateIso: DAY,
      dayBlocks: [
        bar('reg', 'Registration', 8 * 60, 9 * 60),
        bar('pools', 'Pools', 9 * 60, 12 * 60),
      ],
      matches: [],
    });

    expect(plan.refusal).toBeNull();
    expect(plan.blockShifts).toEqual([
      { id: 'reg', startMin: 7 * 60, endMin: 8 * 60 },
      { id: 'pools', startMin: 8 * 60, endMin: 11 * 60 },
    ]);
  });

  it('allows a bar landing exactly on the first and last minutes of the day', () => {
    const toMidnightStart = planBlockMove({
      movedBlockId: 'reg',
      movedBlockLabel: 'Registration',
      deltaMin: -60,
      oldStartMin: 60,
      blockDateIso: DAY,
      dayBlocks: [bar('reg', 'Registration', 60, 120)],
      matches: [],
    });
    expect(toMidnightStart.refusal).toBeNull();

    const toLastMinute = planBlockMove({
      movedBlockId: 'finals',
      movedBlockLabel: 'Finals',
      deltaMin: 29,
      oldStartMin: 22 * 60,
      blockDateIso: DAY,
      dayBlocks: [bar('finals', 'Finals', 22 * 60, 23 * 60 + 30)],
      matches: [],
    });
    expect(toLastMinute.refusal).toBeNull();
    expect(toLastMinute.blockShifts).toEqual([
      { id: 'finals', startMin: 22 * 60 + 29, endMin: 23 * 60 + 59 },
    ]);
  });

  it('plans nothing when the moved bar is not among the day’s rows', () => {
    const plan = planBlockMove({
      movedBlockId: 'ghost',
      movedBlockLabel: 'Ghost',
      deltaMin: 600,
      oldStartMin: 12 * 60,
      blockDateIso: DAY,
      dayBlocks: [bar('finals', 'Finals', 22 * 60, 23 * 60)],
      matches: [],
    });

    // `cascadeBlockShift` already declines an unknown block; refusing on a
    // cascade that is not going to happen would be a phantom 400.
    expect(plan.refusal).toBeNull();
    expect(plan.blockShifts).toEqual([]);
  });
});
