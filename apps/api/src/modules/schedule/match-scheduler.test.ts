import { describe, it, expect } from 'vitest';
import {
  scheduleMatches,
  schedulerSides,
  type SchedulerMatch,
  type SchedulerLice,
} from './match-scheduler';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const START = '2026-04-25T09:00:00.000Z';

function makeMatches(count: number, fightersPerMatch = 2): SchedulerMatch[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `match-${i + 1}`,
    redSideId: `fighter-${((i * fightersPerMatch) % 20) + 1}`,
    blueSideId: `fighter-${((i * fightersPerMatch + 1) % 20) + 2}`,
    estimatedDurationMinutes: 5,
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
    const result = scheduleMatches(matches, lices, {
      startTime: START,
      midRestMinutes: 10,
      transitionMinutes: 2,
    });
    expect(result.scheduledMatches).toHaveLength(8);
    expect(result.unscheduled).toHaveLength(0);
  });

  it('assigns each match a scheduledAt timestamp', () => {
    const matches = makeMatches(4);
    const lices = makeLices(2);
    const result = scheduleMatches(matches, lices, {
      startTime: START,
      midRestMinutes: 10,
      transitionMinutes: 2,
    });
    for (const sm of result.scheduledMatches) {
      expect(sm.scheduledAt).toBeTruthy();
      expect(new Date(sm.scheduledAt).getTime()).toBeGreaterThanOrEqual(new Date(START).getTime());
    }
  });

  // ── KEY AC TEST: a Pool breaks once, and nobody fights twice at once ──────

  it('lets a fighter be called back as soon as their own bout ends', () => {
    // The operator's rule (2026-09-17) replaced the rest after every appearance
    // with one break in the middle of a Pool's queue. These two bouts are not a
    // Pool's, so no break falls between them however long the rest is set.
    const matches: SchedulerMatch[] = [
      { id: 'm1', redSideId: 'f1', blueSideId: 'f2', estimatedDurationMinutes: 5 },
      { id: 'm2', redSideId: 'f1', blueSideId: 'f3', estimatedDurationMinutes: 5 },
    ];

    const result = scheduleMatches(matches, makeLices(2), {
      startTime: START,
      midRestMinutes: 10,
      transitionMinutes: 0,
    });

    const m1 = result.scheduledMatches.find((s) => s.matchId === 'm1')!;
    const m2 = result.scheduledMatches.find((s) => s.matchId === 'm2')!;
    expect(m2.scheduledAt).toBe(m1.estimatedEndAt);
  });

  it('never puts one fighter in two bouts at once, whatever the rest says', () => {
    // The floor the rest rule did NOT take with it. Set to zero so nothing else
    // could be holding the second bout back.
    const matches: SchedulerMatch[] = [
      { id: 'm1', redSideId: 'f1', blueSideId: 'f2', estimatedDurationMinutes: 5 },
      { id: 'm2', redSideId: 'f3', blueSideId: 'f1', estimatedDurationMinutes: 5 },
    ];

    const result = scheduleMatches(matches, makeLices(2), {
      startTime: START,
      midRestMinutes: 0,
      transitionMinutes: 0,
    });

    const m1 = result.scheduledMatches.find((s) => s.matchId === 'm1')!;
    const m2 = result.scheduledMatches.find((s) => s.matchId === 'm2')!;
    expect(new Date(m2.scheduledAt).getTime()).toBeGreaterThanOrEqual(
      new Date(m1.estimatedEndAt).getTime(),
    );
  });

  it("breaks a Pool's queue once, in its middle", () => {
    // SEVEN bouts of one Pool on one piste, not six: half of six is three either
    // way it is rounded, so a six-bout queue cannot tell the rule from its
    // neighbour, and a break repeating every third bout would fall on the last
    // one and be invisible. Seven separates all three. Every fighter is unique,
    // so the no-double-booking floor can never be what moved a bout.
    const matches: SchedulerMatch[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      id: `m${n}`,
      redSideId: `red${n}`,
      blueSideId: `blue${n}`,
      estimatedDurationMinutes: 5,
      poolId: 'pool-a',
      matchNumberLabel: `M${n}`,
    }));

    const result = scheduleMatches(matches, makeLices(1), {
      startTime: START,
      midRestMinutes: 10,
      transitionMinutes: 0,
      poolAffinity: 'strict',
    });

    const startedAt = (id: string) =>
      result.scheduledMatches.find((s) => s.matchId === id)!.scheduledAt;
    const from = (minutes: number) =>
      new Date(new Date(START).getTime() + minutes * 60_000).toISOString();

    expect(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].map(startedAt)).toEqual([
      from(0),
      from(5),
      from(10),
      // The break, once: after the third of seven.
      from(25),
      from(30),
      from(35),
      from(40),
    ]);
  });

  // ── KEY AC TEST: Lices balanced within 5% ────────────────────────────────

  it('Lices balanced within 5% for evenly distributed matches', () => {
    // 28 matches with 56 unique fighters (no fighter repeats) → pure load balancing
    // Each match has unique fighters so rest constraints never block scheduling
    const matches: SchedulerMatch[] = Array.from({ length: 28 }, (_, i) => ({
      id: `match-${i + 1}`,
      redSideId: `fighter-${i * 2 + 1}`,
      blueSideId: `fighter-${i * 2 + 2}`,
      estimatedDurationMinutes: 5,
    }));
    const lices = makeLices(4);
    const result = scheduleMatches(matches, lices, {
      startTime: START,
      midRestMinutes: 10,
      transitionMinutes: 2,
    });

    expect(result.scheduledMatches).toHaveLength(28);
    expect(result.imbalancePercent).toBeLessThanOrEqual(5);
  });

  it('single Lice: all matches on that Lice', () => {
    const matches = makeMatches(6);
    const lices = makeLices(1);
    const result = scheduleMatches(matches, lices, {
      startTime: START,
      midRestMinutes: 10,
      transitionMinutes: 2,
    });
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
    const result = scheduleMatches(matches, lices, {
      startTime: START,
      midRestMinutes: 10,
      transitionMinutes: 2,
    });

    const times = result.scheduledMatches.map((s) => new Date(s.scheduledAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]!);
    }
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('returns empty result for 0 matches', () => {
    const result = scheduleMatches([], makeLices(2), {
      startTime: START,
      midRestMinutes: 10,
      transitionMinutes: 2,
    });
    expect(result.scheduledMatches).toHaveLength(0);
    expect(result.imbalancePercent).toBe(0);
  });

  it('throws when no Lices provided', () => {
    expect(() =>
      scheduleMatches(makeMatches(4), [], { midRestMinutes: 10, transitionMinutes: 2 }),
    ).toThrow('Lice');
  });

  it('liceLoad tracks match count per Lice', () => {
    const matches = makeMatches(4);
    const lices = makeLices(2);
    const result = scheduleMatches(matches, lices, {
      startTime: START,
      midRestMinutes: 10,
      transitionMinutes: 2,
    });
    const totalLoad = Object.values(result.liceLoad).reduce((s, n) => s + n, 0);
    expect(totalLoad).toBe(4);
  });

  // ── Pool affinity (slice 4) ────────────────────────────────────────────────

  describe('pool affinity', () => {
    it('keeps every match of a single pool on one Lice (strict mode)', () => {
      const matches: SchedulerMatch[] = [
        {
          id: 'a1',
          poolId: 'pool-A',
          redSideId: 'f1',
          blueSideId: 'f2',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'a2',
          poolId: 'pool-A',
          redSideId: 'f3',
          blueSideId: 'f4',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'a3',
          poolId: 'pool-A',
          redSideId: 'f1',
          blueSideId: 'f3',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'b1',
          poolId: 'pool-B',
          redSideId: 'f5',
          blueSideId: 'f6',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'b2',
          poolId: 'pool-B',
          redSideId: 'f7',
          blueSideId: 'f8',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'b3',
          poolId: 'pool-B',
          redSideId: 'f5',
          blueSideId: 'f7',
          estimatedDurationMinutes: 5,
        },
      ];
      const lices = makeLices(2);
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'strict',
        midRestMinutes: 0,
        transitionMinutes: 2,
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
          redSideId: `a-f${i * 2 + 1}`,
          blueSideId: `a-f${i * 2 + 2}`,
          estimatedDurationMinutes: 5,
        })),
        ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id, i) => ({
          id,
          poolId: 'pool-B',
          poolSortOrder: 1,
          redSideId: `b-f${i * 2 + 1}`,
          blueSideId: `b-f${i * 2 + 2}`,
          estimatedDurationMinutes: 5,
        })),
      ];
      const lices: SchedulerLice[] = [
        { id: 'lice-1', name: 'Lice 1', sortOrder: 0 },
        { id: 'lice-2', name: 'Lice 2', sortOrder: 1 },
      ];
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'strict',
        midRestMinutes: 0,
        transitionMinutes: 2,
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
          redSideId: 'p1a',
          blueSideId: 'p1b',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'p2',
          poolId: 'P2',
          poolSortOrder: 1,
          redSideId: 'p2a',
          blueSideId: 'p2b',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'p3',
          poolId: 'P3',
          poolSortOrder: 2,
          redSideId: 'p3a',
          blueSideId: 'p3b',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'p4',
          poolId: 'P4',
          poolSortOrder: 3,
          redSideId: 'p4a',
          blueSideId: 'p4b',
          estimatedDurationMinutes: 5,
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
        midRestMinutes: 0,
        transitionMinutes: 2,
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
          redSideId: 'fa',
          blueSideId: 'fb',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'b',
          poolId: 'P',
          matchNumberLabel: 'M1',
          redSideId: 'fc',
          blueSideId: 'fd',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'c',
          poolId: 'P',
          matchNumberLabel: 'M2',
          redSideId: 'fe',
          blueSideId: 'ff',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'd',
          poolId: 'P',
          matchNumberLabel: 'M19',
          redSideId: 'fg',
          blueSideId: 'fh',
          estimatedDurationMinutes: 5,
        },
      ];
      const lices: SchedulerLice[] = [{ id: 'lice-1', name: 'Lice 1', sortOrder: 0 }];
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'strict',
        midRestMinutes: 0,
        transitionMinutes: 2,
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
          redSideId: 'rem',
          blueSideId: 'ant',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'm2',
          poolId: 'P',
          matchNumberLabel: 'M2',
          redSideId: 'val',
          blueSideId: 'cha',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'm3',
          poolId: 'P',
          matchNumberLabel: 'M3',
          redSideId: 'ale',
          blueSideId: 'max',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'm19',
          poolId: 'P',
          matchNumberLabel: 'M19',
          redSideId: 'max',
          blueSideId: 'val',
          estimatedDurationMinutes: 5,
        },
      ];
      const lices: SchedulerLice[] = [{ id: 'lice-1', name: 'Lice 1', sortOrder: 0 }];
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'strict',
        midRestMinutes: 10,
        transitionMinutes: 2,
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
        {
          id: 'm1',
          redSideId: 'f1',
          blueSideId: 'f2',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'm2',
          redSideId: 'f3',
          blueSideId: 'f4',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'm3',
          redSideId: 'f5',
          blueSideId: 'f6',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'm4',
          redSideId: 'f7',
          blueSideId: 'f8',
          estimatedDurationMinutes: 5,
        },
      ];
      const lices = makeLices(2);
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        poolAffinity: 'off',
        midRestMinutes: 0,
        transitionMinutes: 2,
      });

      // With no pool grouping, load should be balanced across the 2 Lices.
      const loads = Object.values(result.liceLoad);
      expect(loads.every((n) => n === 2)).toBe(true);
    });

    it('defaults to strict pool affinity (no opt-in required)', () => {
      const matches: SchedulerMatch[] = [
        {
          id: 'a1',
          poolId: 'pool-A',
          redSideId: 'f1',
          blueSideId: 'f2',
          estimatedDurationMinutes: 5,
        },
        {
          id: 'a2',
          poolId: 'pool-A',
          redSideId: 'f3',
          blueSideId: 'f4',
          estimatedDurationMinutes: 5,
        },
      ];
      const lices = makeLices(2);
      const result = scheduleMatches(matches, lices, {
        startTime: START,
        midRestMinutes: 0,
        transitionMinutes: 2,
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
        redSideId: `f${f++}`,
        blueSideId: `f${f++}`,
        estimatedDurationMinutes: 5,
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
    transitionMinutes: 0,
    midRestMinutes: 0,
  };

  it('gives a bracket branch no break, however long the rest is set', () => {
    // A whole branch on one lice is ONE unit, which is what makes this case
    // different from an unpooled match: an unpooled match is a unit of one, and
    // a unit of one has no middle to break in either way. A fighter appears at
    // most once in a bracket, so it runs straight through.
    const result = scheduleMatches(bracketMatches(16), makeLices(1), {
      ...opts,
      midRestMinutes: 10,
    });

    const byStart = [...result.scheduledMatches].sort(
      (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
    );
    expect(byStart).toHaveLength(15);
    expect(byStart.slice(1).map((m) => m.scheduledAt)).toEqual(
      byStart.slice(0, -1).map((m) => m.estimatedEndAt),
    );
  });

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
      midRestMinutes: 10,
      transitionMinutes: 2,
    });
    expect(result.scheduledMatches).toHaveLength(7);
    expect(result.unscheduled).toHaveLength(0);
  });

  it('seeds a lice from liceBusyUntil so a group appends after occupants', () => {
    const busyUntil = '2026-04-25T10:00:00.000Z';
    const result = scheduleMatches(makeMatches(2), makeLices(1), {
      startTime: START,
      poolAffinity: 'off',
      midRestMinutes: 0,
      transitionMinutes: 0,
      liceBusyUntil: { 'lice-1': busyUntil },
    });
    for (const sm of result.scheduledMatches) {
      expect(new Date(sm.scheduledAt).getTime()).toBeGreaterThanOrEqual(
        new Date(busyUntil).getTime(),
      );
    }
  });

  // Pinned before the side key reached the scheduler (team Tournaments, 1b-1). A bracket
  // placeholder's sides are not known yet (`bracket-placeholder-match.ts`): its null ids share
  // one busy key, so two placeholder bouts never run at once, even on two free pistes.
  it('runs two bracket placeholders one after the other: their unknown sides share one key', () => {
    const placeholder = (id: string): SchedulerMatch => ({
      id,
      ...schedulerSides({
        red_registration_id: null,
        blue_registration_id: null,
        red_team_id: null,
        blue_team_id: null,
      }),
      estimatedDurationMinutes: 5,
    });
    const result = scheduleMatches([placeholder('qf-1'), placeholder('qf-2')], makeLices(2), {
      startTime: START,
      poolAffinity: 'off',
      midRestMinutes: 0,
      transitionMinutes: 0,
    });
    const at = (id: string) => result.scheduledMatches.find((sm) => sm.matchId === id)?.scheduledAt;
    expect(at('qf-1')).toBe(START);
    expect(at('qf-2')).toBe('2026-04-25T09:05:00.000Z');
  });

  // A team bout's Registration ids are null (0282). Keyed by Registration, Lyon v Paris and
  // Nantes v Lille would share the unknown key and run one after the other on two free pistes.
  it('runs two team bouts of four teams side by side on two pistes', () => {
    const teamBout = (id: string, red: string, blue: string): SchedulerMatch => ({
      id,
      ...schedulerSides({
        red_registration_id: null,
        blue_registration_id: null,
        red_team_id: red,
        blue_team_id: blue,
      }),
      estimatedDurationMinutes: 5,
    });
    const result = scheduleMatches(
      [teamBout('m-1', 'team-lyon', 'team-paris'), teamBout('m-2', 'team-nantes', 'team-lille')],
      makeLices(2),
      { startTime: START, poolAffinity: 'off', midRestMinutes: 0, transitionMinutes: 0 },
    );
    expect(result.scheduledMatches.map((sm) => [sm.matchId, sm.liceId, sm.scheduledAt])).toEqual([
      ['m-1', 'lice-1', START],
      ['m-2', 'lice-2', START],
    ]);
  });

  it('keys an individual side by its Registration, and refuses a side that names both', () => {
    const sides = {
      red_registration_id: 'reg-anna',
      blue_registration_id: 'reg-ben',
      red_team_id: null,
      blue_team_id: null,
    };
    expect(schedulerSides(sides)).toEqual({ redSideId: 'reg-anna', blueSideId: 'reg-ben' });
    expect(() => schedulerSides({ ...sides, red_team_id: 'team-lyon' })).toThrow(
      'a side is either a Registration or a Team',
    );
  });
});
