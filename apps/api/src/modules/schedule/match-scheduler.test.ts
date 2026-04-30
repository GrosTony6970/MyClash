import { describe, it, expect } from 'vitest';
import { scheduleMatches, type SchedulerMatch, type SchedulerLice } from './match-scheduler';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const START = '2026-04-25T09:00:00.000Z';

function makeMatches(count: number, fightersPerMatch = 2): SchedulerMatch[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `match-${i + 1}`,
    redRegistrationId: `fighter-${(i * fightersPerMatch) % 20 + 1}`,
    blueRegistrationId: `fighter-${(i * fightersPerMatch + 1) % 20 + 2}`,
  }));
}

function makeLices(count: number): SchedulerLice[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `lice-${i + 1}`,
    name: `Lice ${i + 1}`,
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('scheduleMatches', () => {

  // ── Basic scheduling ──────────────────────────────────────────────────────

  it('schedules all matches when enough Lices available', () => {
    const matches = makeMatches(8);
    const lices = makeLices(2);
    const result = scheduleMatches(matches, lices, { startTime: START });
    expect(result.scheduledMatches).toHaveLength(8);
    expect(result.unscheduled).toHaveLength(0);
  });

  it('assigns each match a scheduledAt timestamp', () => {
    const matches = makeMatches(4);
    const lices = makeLices(2);
    const result = scheduleMatches(matches, lices, { startTime: START });
    for (const sm of result.scheduledMatches) {
      expect(sm.scheduledAt).toBeTruthy();
      expect(new Date(sm.scheduledAt).getTime()).toBeGreaterThanOrEqual(new Date(START).getTime());
    }
  });

  // ── KEY AC TEST: no back-to-back matches without rest ─────────────────────

  it('no fighter has back-to-back matches without minRestMinutes rest', () => {
    // Fighter 1 appears in match 1 and match 2 — must have 10 min rest between
    const matches: SchedulerMatch[] = [
      { id: 'm1', redRegistrationId: 'f1', blueRegistrationId: 'f2' },
      { id: 'm2', redRegistrationId: 'f1', blueRegistrationId: 'f3' }, // f1 fights again
      { id: 'm3', redRegistrationId: 'f4', blueRegistrationId: 'f5' },
    ];
    const lices = makeLices(2);
    const minRestMinutes = 10;
    const defaultMatchDurationMinutes = 5;

    const result = scheduleMatches(matches, lices, {
      startTime: START,
      minRestMinutes,
      defaultMatchDurationMinutes,
    });

    // Find m1 and m2 for fighter f1
    const m1 = result.scheduledMatches.find((s) => s.matchId === 'm1')!;
    const m2 = result.scheduledMatches.find((s) => s.matchId === 'm2')!;

    expect(m1).toBeDefined();
    expect(m2).toBeDefined();

    const m1End = new Date(m1.estimatedEndAt).getTime();
    const m2Start = new Date(m2.scheduledAt).getTime();
    const restMs = m2Start - m1End;
    const restMinutes = restMs / 60_000;

    expect(restMinutes).toBeGreaterThanOrEqual(minRestMinutes);
  });

  it('respects minRestMinutes=0 (back-to-back allowed)', () => {
    const matches: SchedulerMatch[] = [
      { id: 'm1', redRegistrationId: 'f1', blueRegistrationId: 'f2' },
      { id: 'm2', redRegistrationId: 'f1', blueRegistrationId: 'f3' },
    ];
    const lices = makeLices(2);
    const result = scheduleMatches(matches, lices, {
      startTime: START,
      minRestMinutes: 0,
      defaultMatchDurationMinutes: 5,
    });

    const m1 = result.scheduledMatches.find((s) => s.matchId === 'm1')!;
    const m2 = result.scheduledMatches.find((s) => s.matchId === 'm2')!;
    const m1End = new Date(m1.estimatedEndAt).getTime();
    const m2Start = new Date(m2.scheduledAt).getTime();

    // With 0 rest, m2 can start immediately after m1 ends (+ transition gap only)
    expect(m2Start).toBeGreaterThanOrEqual(m1End);
  });

  // ── KEY AC TEST: Lices balanced within 5% ────────────────────────────────

  it('Lices balanced within 5% for evenly distributed matches', () => {
    // 28 matches with 56 unique fighters (no fighter repeats) → pure load balancing
    // Each match has unique fighters so rest constraints never block scheduling
    const matches: SchedulerMatch[] = Array.from({ length: 28 }, (_, i) => ({
      id: `match-${i + 1}`,
      redRegistrationId: `fighter-${i * 2 + 1}`,
      blueRegistrationId: `fighter-${i * 2 + 2}`,
    }));
    const lices = makeLices(4);
    const result = scheduleMatches(matches, lices, {
      startTime: START,
      minRestMinutes: 10,
      defaultMatchDurationMinutes: 5,
    });

    expect(result.scheduledMatches).toHaveLength(28);
    expect(result.imbalancePercent).toBeLessThanOrEqual(5);
  });

  it('single Lice: all matches on that Lice', () => {
    const matches = makeMatches(6);
    const lices = makeLices(1);
    const result = scheduleMatches(matches, lices, { startTime: START });
    expect(result.scheduledMatches).toHaveLength(6);
    for (const sm of result.scheduledMatches) {
      expect(sm.liceId).toBe('lice-1');
    }
    expect(result.imbalancePercent).toBe(0);
  });

  // ── Timestamps are ordered ────────────────────────────────────────────────

  it('matches on the same Lice are ordered chronologically', () => {
    const matches = makeMatches(6);
    const lices = makeLices(1);
    const result = scheduleMatches(matches, lices, { startTime: START });

    const times = result.scheduledMatches.map((s) => new Date(s.scheduledAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]!);
    }
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('returns empty result for 0 matches', () => {
    const result = scheduleMatches([], makeLices(2), { startTime: START });
    expect(result.scheduledMatches).toHaveLength(0);
    expect(result.imbalancePercent).toBe(0);
  });

  it('throws when no Lices provided', () => {
    expect(() => scheduleMatches(makeMatches(4), [])).toThrow('Lice');
  });

  it('liceLoad tracks match count per Lice', () => {
    const matches = makeMatches(4);
    const lices = makeLices(2);
    const result = scheduleMatches(matches, lices, { startTime: START });
    const totalLoad = Object.values(result.liceLoad).reduce((s, n) => s + n, 0);
    expect(totalLoad).toBe(4);
  });
});
