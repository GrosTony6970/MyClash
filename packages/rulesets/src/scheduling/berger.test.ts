/**
 * Berger table tests — verified against known round-robin schedules.
 * Reference: https://en.wikipedia.org/wiki/Round-robin_tournament#Circle_method
 */
import { describe, it, expect } from 'vitest';
import { bergerSchedule, totalMatches, totalRounds } from './berger';

// ── totalMatches / totalRounds ────────────────────────────────────────────────

describe('totalMatches', () => {
  it('2 players → 1 match', () => expect(totalMatches(2)).toBe(1));
  it('4 players → 6 matches', () => expect(totalMatches(4)).toBe(6));
  it('6 players → 15 matches', () => expect(totalMatches(6)).toBe(15));
  it('8 players → 28 matches', () => expect(totalMatches(8)).toBe(28));
  it('formula: n*(n-1)/2', () => {
    for (let n = 2; n <= 12; n++) {
      expect(totalMatches(n)).toBe((n * (n - 1)) / 2);
    }
  });
});

describe('totalRounds', () => {
  it('even N: N-1 rounds', () => {
    expect(totalRounds(4)).toBe(3);
    expect(totalRounds(6)).toBe(5);
    expect(totalRounds(8)).toBe(7);
  });
  it('odd N: N rounds', () => {
    expect(totalRounds(3)).toBe(3);
    expect(totalRounds(5)).toBe(5);
    expect(totalRounds(7)).toBe(7);
  });
});

// ── bergerSchedule ────────────────────────────────────────────────────────────

describe('bergerSchedule', () => {
  // ── KEY AC TEST: 8-fighter pool → 28 matches in 7 rounds ─────────────────
  it('8 players → 28 matches in 7 rounds', () => {
    const matches = bergerSchedule(8);
    expect(matches).toHaveLength(28);
    const rounds = new Set(matches.map((m) => m.round));
    expect(rounds.size).toBe(7);
    // Each round has exactly 4 matches
    for (let r = 1; r <= 7; r++) {
      const roundMatches = matches.filter((m) => m.round === r);
      expect(roundMatches).toHaveLength(4);
    }
  });

  it('4 players → 6 matches in 3 rounds', () => {
    const matches = bergerSchedule(4);
    expect(matches).toHaveLength(6);
    const rounds = new Set(matches.map((m) => m.round));
    expect(rounds.size).toBe(3);
  });

  it('6 players → 15 matches in 5 rounds', () => {
    const matches = bergerSchedule(6);
    expect(matches).toHaveLength(15);
    const rounds = new Set(matches.map((m) => m.round));
    expect(rounds.size).toBe(5);
  });

  // ── Odd N ─────────────────────────────────────────────────────────────────
  it('5 players → 10 matches in 5 rounds (bye handled)', () => {
    const matches = bergerSchedule(5);
    expect(matches).toHaveLength(10);
    const rounds = new Set(matches.map((m) => m.round));
    expect(rounds.size).toBe(5);
    // Each round has 2 matches (one player has a bye)
    for (let r = 1; r <= 5; r++) {
      const roundMatches = matches.filter((m) => m.round === r);
      expect(roundMatches).toHaveLength(2);
    }
  });

  it('7 players → 21 matches in 7 rounds', () => {
    const matches = bergerSchedule(7);
    expect(matches).toHaveLength(21);
  });

  // ── Match labels ──────────────────────────────────────────────────────────
  it('match labels follow L{lice}-P{pool}-M{seq} format', () => {
    const matches = bergerSchedule(4, { liceLabel: '2', poolLabel: 'B' });
    expect(matches[0]?.label).toBe('L2-PB-M1');
    expect(matches[1]?.label).toBe('L2-PB-M2');
    expect(matches[5]?.label).toBe('L2-PB-M6');
  });

  it('default labels use L1-PA', () => {
    const matches = bergerSchedule(4);
    expect(matches[0]?.label).toBe('L1-PA-M1');
  });

  // ── Sequence numbers ──────────────────────────────────────────────────────
  it('sequence numbers are 1-indexed and contiguous', () => {
    const matches = bergerSchedule(6);
    const seqs = matches.map((m) => m.sequence).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  // ── Each player appears exactly once per round ────────────────────────────
  it('each player appears exactly once per round (even N)', () => {
    const n = 8;
    const matches = bergerSchedule(n);
    for (let r = 1; r <= 7; r++) {
      const roundMatches = matches.filter((m) => m.round === r);
      const players = new Set<number>();
      for (const m of roundMatches) {
        expect(players.has(m.homeIndex)).toBe(false);
        expect(players.has(m.awayIndex)).toBe(false);
        players.add(m.homeIndex);
        players.add(m.awayIndex);
      }
      expect(players.size).toBe(n);
    }
  });

  // ── Each pair plays exactly once ──────────────────────────────────────────
  it('each pair of players meets exactly once', () => {
    const n = 6;
    const matches = bergerSchedule(n);
    const pairs = new Set<string>();
    for (const m of matches) {
      const key = [Math.min(m.homeIndex, m.awayIndex), Math.max(m.homeIndex, m.awayIndex)].join(
        '-',
      );
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
    }
    expect(pairs.size).toBe(totalMatches(n));
  });

  // ── Deterministic ─────────────────────────────────────────────────────────
  it('is deterministic — same input always same output', () => {
    const m1 = bergerSchedule(8);
    const m2 = bergerSchedule(8);
    expect(m1).toEqual(m2);
  });

  // ── Known Berger schedule for 4 players ──────────────────────────────────
  // Verified against: https://en.wikipedia.org/wiki/Round-robin_tournament
  // Players: 0,1,2,3
  // Round 1: (0 vs 3), (1 vs 2)
  // Round 2: (0 vs 2), (3 vs 1)
  // Round 3: (0 vs 1), (2 vs 3)
  it('4-player schedule matches known Berger table', () => {
    const matches = bergerSchedule(4);
    const byRound = (r: number) => matches.filter((m) => m.round === r);

    const r1 = byRound(1);
    expect(r1).toHaveLength(2);
    // Round 1: 0 vs 3, 1 vs 2
    const r1Pairs = r1.map((m) => [m.homeIndex, m.awayIndex].sort().join('-')).sort();
    expect(r1Pairs).toContain('0-3');
    expect(r1Pairs).toContain('1-2');

    // All 6 pairs covered
    const allPairs = matches.map((m) => [m.homeIndex, m.awayIndex].sort().join('-')).sort();
    expect(allPairs).toEqual(['0-1', '0-2', '0-3', '1-2', '1-3', '2-3']);
  });

  it('throws for fewer than 2 players', () => {
    expect(() => bergerSchedule(1)).toThrow();
    expect(() => bergerSchedule(0)).toThrow();
  });
});
