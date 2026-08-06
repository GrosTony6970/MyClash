import { describe, expect, it } from 'vitest';
import {
  dueForSec,
  elapsedSec,
  fallbackTiming,
  idleForSec,
  projectedFinishMs,
  runningOverSec,
  startedLateSec,
} from './live-board-timing';
import { NOW, agoIso, mkMatch, mkRow } from './live-board.fixtures';

describe('elapsedSec', () => {
  it('measures from the bout start', () => {
    expect(elapsedSec(mkRow({ currentMatch: mkMatch({ startedAt: agoIso(90) }) }), NOW)).toBe(90);
  });

  it('is null before the bout starts, and on an empty piste', () => {
    expect(elapsedSec(mkRow({ currentMatch: mkMatch({ startedAt: null }) }), NOW)).toBeNull();
    expect(elapsedSec(mkRow({ currentMatch: null }), NOW)).toBeNull();
  });

  it('clamps a future start to zero rather than going negative', () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(elapsedSec(mkRow({ currentMatch: mkMatch({ startedAt: future }) }), NOW)).toBe(0);
  });

  it('is null on an unparseable timestamp instead of NaN', () => {
    expect(elapsedSec(mkRow({ currentMatch: mkMatch({ startedAt: 'nope' }) }), NOW)).toBeNull();
  });
});

describe('startedLateSec', () => {
  it('measures start against slot, and does NOT grow as the bout runs', () => {
    // A bout that began 6 min late stays 6 min late — growing it would
    // double-count the overrun that runningOverSec already reports.
    const row = mkRow({
      currentMatch: mkMatch({ scheduledAt: agoIso(960), startedAt: agoIso(600) }),
    });
    expect(startedLateSec(row)).toBe(360);
  });

  it('is zero for a bout that started early or on time', () => {
    const row = mkRow({
      currentMatch: mkMatch({ scheduledAt: agoIso(600), startedAt: agoIso(900) }),
    });
    expect(startedLateSec(row)).toBe(0);
  });

  it('is null without both timestamps', () => {
    expect(startedLateSec(mkRow({ currentMatch: mkMatch({ scheduledAt: null }) }))).toBeNull();
    expect(startedLateSec(mkRow({ currentMatch: null }))).toBeNull();
  });
});

describe('dueForSec', () => {
  it('measures how overdue a not-yet-started bout is', () => {
    const row = mkRow({
      currentMatch: mkMatch({ status: 'scheduled', startedAt: null, scheduledAt: agoIso(300) }),
    });
    expect(dueForSec(row, NOW)).toBe(300);
  });

  it('is null once the bout has started', () => {
    const row = mkRow({
      currentMatch: mkMatch({ scheduledAt: agoIso(300), startedAt: agoIso(120) }),
    });
    expect(dueForSec(row, NOW)).toBeNull();
  });
});

describe('idleForSec', () => {
  it('measures from the last bout ending', () => {
    const row = mkRow({ lastCompleted: { matchId: 'm0', label: '#0', endedAt: agoIso(420) } });
    expect(idleForSec(row, NOW)).toBe(420);
  });

  it('is null with no history — there is nothing to be idle since', () => {
    expect(idleForSec(mkRow({ lastCompleted: null }), NOW)).toBeNull();
    const noEnd = mkRow({ lastCompleted: { matchId: 'm0', label: '#0', endedAt: null } });
    expect(idleForSec(noEnd, NOW)).toBeNull();
  });
});

describe('runningOverSec', () => {
  it('is the excess over the planned slot', () => {
    const row = mkRow({ currentMatch: mkMatch({ startedAt: agoIso(500) }) });
    expect(runningOverSec(row, NOW, 5)).toBe(200);
  });

  it('is zero, not negative, inside the slot', () => {
    const row = mkRow({ currentMatch: mkMatch({ startedAt: agoIso(60) }) });
    expect(runningOverSec(row, NOW, 5)).toBe(0);
  });

  it('is null when the bout has not started', () => {
    expect(runningOverSec(mkRow({ currentMatch: null }), NOW, 5)).toBeNull();
  });
});

describe('projectedFinishMs', () => {
  it('divides the remaining bouts across the pistes actually running', () => {
    // 20 bouts over 4 pistes = 5 rounds of 5 min = 25 min.
    expect(projectedFinishMs(NOW, 20, 4, 5)).toBe(NOW + 25 * 60_000);
  });

  it('rounds a partial round up', () => {
    expect(projectedFinishMs(NOW, 5, 4, 5)).toBe(NOW + 2 * 5 * 60_000);
  });

  it('is null with nothing left, or with nothing running', () => {
    // A projection off zero pistes is a divide-by-zero dressed as information.
    expect(projectedFinishMs(NOW, 0, 4, 5)).toBeNull();
    expect(projectedFinishMs(NOW, 20, 0, 5)).toBeNull();
  });
});

describe('fallbackTiming', () => {
  it('dates itself and uses the documented default slot', () => {
    const timing = fallbackTiming(NOW);
    expect(timing.block).toBeNull();
    expect(timing.matchDurationMinutes).toBe(5);
    expect(Date.parse(timing.nowIso)).toBe(NOW);
  });
});
