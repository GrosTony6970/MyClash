import { describe, it, expect } from 'vitest';
import { scheduleMatches, type SchedulerMatch, type SchedulerLice } from './match-scheduler';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const START = '2026-04-25T09:00:00.000Z';

function makeMatches(count: number, fightersPerMatch = 2): SchedulerMatch[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `match-${i + 1}`,
    redRegistrationId: `fighter-${((i * fightersPerMatch) % 20) + 1}`,
    blueRegistrationId: `fighter-${((i * fightersPerMatch + 1) % 20) + 2}`,
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

  // ── Pool affinity (slice 4) ────────────────────────────────────────────────

  describe('pool affinity', () => {
    it('keeps every match of a single pool on one Lice (strict mode)', () => {
      const matches: SchedulerMatch[] = [
        { id: 'a1', poolId: 'pool-A', redRegistrationId: 'f1', blueRegistrationId: 'f2' },
        { id: 'a2', poolId: 'pool-A', redRegistrationId: 'f3', blueRegistrationId: 'f4' },
        { id: 'a3', poolId: 'pool-A', redRegistrationId: 'f1', blueRegistrationId: 'f3' },
        { id: 'b1', poolId: 'pool-B', redRegistrationId: 'f5', blueRegistrationId: 'f6' },
        { id: 'b2', poolId: 'pool-B', redRegistrationId: 'f7', blueRegistrationId: 'f8' },
        { id: 'b3', poolId: 'pool-B', redRegistrationId: 'f5', blueRegistrationId: 'f7' },
      ];
      const lices = makeLices(2);
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'strict',
        minRestMinutes: 0,
        defaultMatchDurationMinutes: 5,
      });

      // Each pool collapses to a single Lice.
      const poolALices = new Set(
        result.scheduledMatches
          .filter((s) => ['a1', 'a2', 'a3'].includes(s.matchId))
          .map((s) => s.liceId),
      );
      const poolBLices = new Set(
        result.scheduledMatches
          .filter((s) => ['b1', 'b2', 'b3'].includes(s.matchId))
          .map((s) => s.liceId),
      );

      expect(poolALices.size).toBe(1);
      expect(poolBLices.size).toBe(1);
      // The two pools should land on different Lices to balance load.
      expect(Array.from(poolALices)[0]).not.toBe(Array.from(poolBLices)[0]);
    });

    it('lands pool i on lice i sorted by poolSortOrder regardless of pool size', () => {
      // The operator's mental model is "Pool 1 → Lice 1, Pool 2 →
      // Lice 2", not "biggest pool first". Even though pool-A is
      // smaller than pool-B, pool-A's sortOrder=0 puts it on lice 1.
      const matches: SchedulerMatch[] = [
        ...['a1', 'a2'].map((id, i) => ({
          id,
          poolId: 'pool-A',
          poolSortOrder: 0,
          redRegistrationId: `a-f${i * 2 + 1}`,
          blueRegistrationId: `a-f${i * 2 + 2}`,
        })),
        ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id, i) => ({
          id,
          poolId: 'pool-B',
          poolSortOrder: 1,
          redRegistrationId: `b-f${i * 2 + 1}`,
          blueRegistrationId: `b-f${i * 2 + 2}`,
        })),
      ];
      const lices: SchedulerLice[] = [
        { id: 'lice-1', name: 'Lice 1', sortOrder: 0 },
        { id: 'lice-2', name: 'Lice 2', sortOrder: 1 },
      ];
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'strict',
        minRestMinutes: 0,
        defaultMatchDurationMinutes: 5,
      });

      const poolA = result.scheduledMatches.find((s) => s.matchId === 'a1')!;
      const poolB = result.scheduledMatches.find((s) => s.matchId === 'b1')!;
      expect(poolA.liceId).toBe('lice-1');
      expect(poolB.liceId).toBe('lice-2');
    });

    it('wraps pools modulo lice count when there are more pools than lices', () => {
      const matches: SchedulerMatch[] = [
        {
          id: 'p1',
          poolId: 'P1',
          poolSortOrder: 0,
          redRegistrationId: 'p1a',
          blueRegistrationId: 'p1b',
        },
        {
          id: 'p2',
          poolId: 'P2',
          poolSortOrder: 1,
          redRegistrationId: 'p2a',
          blueRegistrationId: 'p2b',
        },
        {
          id: 'p3',
          poolId: 'P3',
          poolSortOrder: 2,
          redRegistrationId: 'p3a',
          blueRegistrationId: 'p3b',
        },
        {
          id: 'p4',
          poolId: 'P4',
          poolSortOrder: 3,
          redRegistrationId: 'p4a',
          blueRegistrationId: 'p4b',
        },
      ];
      const lices: SchedulerLice[] = [
        { id: 'lice-1', name: 'Lice 1', sortOrder: 0 },
        { id: 'lice-2', name: 'Lice 2', sortOrder: 1 },
        { id: 'lice-3', name: 'Lice 3', sortOrder: 2 },
      ];
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'strict',
        minRestMinutes: 0,
        defaultMatchDurationMinutes: 5,
      });

      const liceOf = (id: string) => result.scheduledMatches.find((s) => s.matchId === id)!.liceId;
      expect(liceOf('p1')).toBe('lice-1');
      expect(liceOf('p2')).toBe('lice-2');
      expect(liceOf('p3')).toBe('lice-3');
      // 4 pools, 3 lices: pool 4 wraps onto lice 1.
      expect(liceOf('p4')).toBe('lice-1');
    });

    it('iterates pool matches in numeric matchNumberLabel order (M1, M2, ... M10) not string sort', () => {
      // Reproduces the operator-visible bug: matches stored as text
      // labels M1, M10, M11, ..., M19, M2 would be processed in
      // string order, putting M2 way after M19 and creating a
      // fighter-overlap conflict when the rest tracker had already
      // expired Valentin's rest from M19.
      const matches: SchedulerMatch[] = [
        {
          id: 'a',
          poolId: 'P',
          matchNumberLabel: 'M10',
          redRegistrationId: 'fa',
          blueRegistrationId: 'fb',
        },
        {
          id: 'b',
          poolId: 'P',
          matchNumberLabel: 'M1',
          redRegistrationId: 'fc',
          blueRegistrationId: 'fd',
        },
        {
          id: 'c',
          poolId: 'P',
          matchNumberLabel: 'M2',
          redRegistrationId: 'fe',
          blueRegistrationId: 'ff',
        },
        {
          id: 'd',
          poolId: 'P',
          matchNumberLabel: 'M19',
          redRegistrationId: 'fg',
          blueRegistrationId: 'fh',
        },
      ];
      const lices: SchedulerLice[] = [{ id: 'lice-1', name: 'Lice 1', sortOrder: 0 }];
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'strict',
        minRestMinutes: 0,
        defaultMatchDurationMinutes: 5,
      });
      const ordered = [...result.scheduledMatches].sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      );
      expect(ordered.map((s) => s.matchId)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('does not let two matches sharing a fighter overlap (M19/M2 same-pool case)', () => {
      // Same Valentin in M2 and M19 of the same pool. Numeric order
      // schedules M2 right after M1; rest tracker pushes M19 well
      // after M2 ends + minRest. They cannot collide.
      const matches: SchedulerMatch[] = [
        {
          id: 'm1',
          poolId: 'P',
          matchNumberLabel: 'M1',
          redRegistrationId: 'rem',
          blueRegistrationId: 'ant',
        },
        {
          id: 'm2',
          poolId: 'P',
          matchNumberLabel: 'M2',
          redRegistrationId: 'val',
          blueRegistrationId: 'cha',
        },
        {
          id: 'm3',
          poolId: 'P',
          matchNumberLabel: 'M3',
          redRegistrationId: 'ale',
          blueRegistrationId: 'max',
        },
        {
          id: 'm19',
          poolId: 'P',
          matchNumberLabel: 'M19',
          redRegistrationId: 'max',
          blueRegistrationId: 'val',
        },
      ];
      const lices: SchedulerLice[] = [{ id: 'lice-1', name: 'Lice 1', sortOrder: 0 }];
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'strict',
        minRestMinutes: 10,
        defaultMatchDurationMinutes: 5,
      });
      const m2 = result.scheduledMatches.find((s) => s.matchId === 'm2')!;
      const m19 = result.scheduledMatches.find((s) => s.matchId === 'm19')!;
      const m2End = new Date(m2.estimatedEndAt).getTime();
      const m19Start = new Date(m19.scheduledAt).getTime();
      expect(m19Start).toBeGreaterThanOrEqual(m2End + 10 * 60_000);
    });

    it('falls back to per-match greedy when poolAffinity is "off" (bracket behaviour)', () => {
      // Bracket matches have no shared poolId. Even with poolAffinity
      // configured, each match should still get the earliest-available
      // Lice independently.
      const matches: SchedulerMatch[] = [
        { id: 'm1', redRegistrationId: 'f1', blueRegistrationId: 'f2' },
        { id: 'm2', redRegistrationId: 'f3', blueRegistrationId: 'f4' },
        { id: 'm3', redRegistrationId: 'f5', blueRegistrationId: 'f6' },
        { id: 'm4', redRegistrationId: 'f7', blueRegistrationId: 'f8' },
      ];
      const lices = makeLices(2);
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'off',
        minRestMinutes: 0,
        defaultMatchDurationMinutes: 5,
      });

      // With no pool grouping, load should be balanced across the 2 Lices.
      const loads = Object.values(result.liceLoad);
      expect(loads.every((n) => n === 2)).toBe(true);
    });

    it('defaults to strict pool affinity (no opt-in required)', () => {
      const matches: SchedulerMatch[] = [
        { id: 'a1', poolId: 'pool-A', redRegistrationId: 'f1', blueRegistrationId: 'f2' },
        { id: 'a2', poolId: 'pool-A', redRegistrationId: 'f3', blueRegistrationId: 'f4' },
      ];
      const lices = makeLices(2);
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        minRestMinutes: 0,
        defaultMatchDurationMinutes: 5,
      });

      const used = new Set(result.scheduledMatches.map((s) => s.liceId));
      expect(used.size).toBe(1);
    });
  });
});

// ── Branch-aware bracket scheduling ────────────────────────────────────────────

/** Full single-elim bracket as scheduler matches; ids "R{r}P{p}", unique fighters. */
function bracketMatches(size: number): SchedulerMatch[] {
  const rounds = Math.log2(size);
  const out: SchedulerMatch[] = [];
  let f = 0;
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let p = 1; p <= count; p++) {
      out.push({
        id: `R${r}P${p}`,
        redRegistrationId: `f${f++}`,
        blueRegistrationId: `f${f++}`,
        bracketRound: r,
        bracketPosition: p,
      });
    }
  }
  return out;
}

describe('scheduleMatches — bracket-branch affinity', () => {
  const opts = {
    startTime: START,
    poolAffinity: 'bracket-branch' as const,
    defaultMatchDurationMinutes: 5,
    transitionMinutes: 0,
    minRestMinutes: 0,
  };

  it('keeps each quarter-final sub-tree on one lice, across four lices', () => {
    const result = scheduleMatches(bracketMatches(32), makeLices(4), opts);
    const liceOf = new Map(result.scheduledMatches.map((s) => [s.matchId, s.liceId]));
    const qf1 = ['R1P1', 'R1P2', 'R1P3', 'R1P4', 'R2P1', 'R2P2', 'R3P1'];
    expect(new Set(qf1.map((id) => liceOf.get(id))).size).toBe(1);
    const anchorLices = new Set(['R3P1', 'R3P2', 'R3P3', 'R3P4'].map((id) => liceOf.get(id)));
    expect(anchorLices.size).toBe(4);
  });

  it('converges the semis/final onto a contributing lice, after its sub-tree', () => {
    const result = scheduleMatches(bracketMatches(32), makeLices(4), opts);
    const at = (id: string) =>
      new Date(result.scheduledMatches.find((s) => s.matchId === id)!.scheduledAt).getTime();
    const liceOf = new Map(result.scheduledMatches.map((s) => [s.matchId, s.liceId]));
    const anchorLices = new Set(['R3P1', 'R3P2', 'R3P3', 'R3P4'].map((id) => liceOf.get(id)));
    expect(anchorLices.has(liceOf.get('R4P1'))).toBe(true);
    expect(anchorLices.has(liceOf.get('R5P1'))).toBe(true);
    // Final after the semi that shares its lice / sub-tree.
    expect(at('R5P1')).toBeGreaterThan(at('R4P1'));
  });

  it('orders matches earliest round first within a branch', () => {
    const result = scheduleMatches(bracketMatches(32), makeLices(4), opts);
    const at = (id: string) =>
      new Date(result.scheduledMatches.find((s) => s.matchId === id)!.scheduledAt).getTime();
    expect(at('R1P1')).toBeLessThan(at('R2P1'));
    expect(at('R2P1')).toBeLessThan(at('R3P1'));
  });

  it("leaves 'off' affinity greedy even when bracket coords are present", () => {
    const result = scheduleMatches(bracketMatches(8), makeLices(4), {
      startTime: START,
      poolAffinity: 'off',
    });
    expect(result.scheduledMatches).toHaveLength(7);
    expect(result.unscheduled).toHaveLength(0);
  });

  it('seeds a lice from liceBusyUntil so a group appends after occupants', () => {
    const busyUntil = '2026-04-25T10:00:00.000Z';
    const result = scheduleMatches(makeMatches(2), makeLices(1), {
      startTime: START,
      poolAffinity: 'off',
      minRestMinutes: 0,
      transitionMinutes: 0,
      liceBusyUntil: { 'lice-1': busyUntil },
    });
    for (const sm of result.scheduledMatches) {
      expect(new Date(sm.scheduledAt).getTime()).toBeGreaterThanOrEqual(
        new Date(busyUntil).getTime(),
      );
    }
  });
});
