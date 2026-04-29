/**
 * TF_v1 standings.ts — unit tests
 * Verifies tiebreaker order from ARCHITECTURE.md §6.3.
 */
import { describe, it, expect } from 'vitest';
import { computePoolStandings } from './standings';
import { TFv1DefaultConfig } from './config';
import type { Exchange, Match, Pool, Registration } from '../types';

const POOL: Pool = { id: 'pool-1', name: 'Pool A' };

function makeReg(id: string, seed: number | null = null): Registration {
  return { id, seed, bibNumber: null };
}

function makeMatch(
  id: string,
  redId: string,
  blueId: string,
  exchanges: Exchange[],
  winnerId?: string,
): Match & { exchanges: Exchange[]; winnerRegistrationId?: string } {
  return {
    id,
    redRegistrationId: redId,
    blueRegistrationId: blueId,
    rulesetCode: 'TF_v1',
    rulesetVersion: '1.0.0',
    status: 'completed',
    exchanges,
    winnerRegistrationId: winnerId,
  };
}

function makeClean(id: string, seq: number, striker: 'red' | 'blue', value: 1 | 2 = 1): Exchange {
  return {
    id, clientUuid: id, matchId: 'm1', sequence: seq,
    type: 'clean', occurredAt: new Date().toISOString(),
    firstStrikerColor: striker, firstStrikeValue: value,
    afterblowValue: null, noExchangeReason: null, voided: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computePoolStandings', () => {
  it('returns one row per registration', () => {
    const regs = [makeReg('r1'), makeReg('r2'), makeReg('r3')];
    const rows = computePoolStandings(POOL, [], regs, TFv1DefaultConfig);
    expect(rows).toHaveLength(3);
  });

  it('assigns rank 1 to the fighter with highest score', () => {
    const regs = [makeReg('r1'), makeReg('r2')];
    const matches = [
      makeMatch('m1', 'r1', 'r2',
        [makeClean('e1', 1, 'red', 1), makeClean('e2', 2, 'red', 1), makeClean('e3', 3, 'red', 1)],
        'r1', // r1 wins
      ),
    ];
    const rows = computePoolStandings(POOL, matches, regs, TFv1DefaultConfig);
    const r1 = rows.find((r) => r.registrationId === 'r1')!;
    const r2 = rows.find((r) => r.registrationId === 'r2')!;
    expect(r1.rank).toBe(1);
    expect(r2.rank).toBe(2);
    expect(r1.wins).toBe(1);
    expect(r2.wins).toBe(0);
  });

  it('tiebreaker 1: higher score wins', () => {
    // r1: wins=1, pts=5, hit=2, dbl=0 → score=(3+5)/(2+0)=4
    // r2: wins=1, pts=3, hit=2, dbl=0 → score=(3+3)/(2+0)=3
    const regs = [makeReg('r1'), makeReg('r2')];
    const m1 = makeMatch('m1', 'r1', 'r2',
      [makeClean('e1', 1, 'red', 2), makeClean('e2', 2, 'red', 2), makeClean('e3', 3, 'blue', 1), makeClean('e4', 4, 'blue', 1)],
      'r1',
    );
    const m2 = makeMatch('m2', 'r2', 'r1',
      [makeClean('e5', 1, 'red', 1), makeClean('e6', 2, 'red', 1), makeClean('e7', 3, 'blue', 1), makeClean('e8', 4, 'blue', 1)],
      'r2',
    );
    const rows = computePoolStandings(POOL, [m1, m2], regs, TFv1DefaultConfig);
    // Both have 1 win. r1 has more target points → higher score
    const r1 = rows.find((r) => r.registrationId === 'r1')!;
    const r2 = rows.find((r) => r.registrationId === 'r2')!;
    expect(r1.rank).toBeLessThan(r2.rank);
  });

  it('tiebreaker 2: more wins wins when scores are equal', () => {
    // Construct scenario where scores are equal but wins differ
    const regs = [makeReg('r1', 1), makeReg('r2', 2)];
    // r1: wins=2, pts=0, hit=0, dbl=0 → score=6/0=6 (edge case)
    // r2: wins=1, pts=3, hit=0, dbl=0 → score=6/0=6 (edge case)
    // Both score=6 (denominator=0 → numerator), r1 has more wins
    const rows = computePoolStandings(POOL, [], regs, TFv1DefaultConfig);
    // With no matches, all zeros → score=0, tiebreak by seed
    expect(rows[0]?.registrationId).toBe('r1'); // seed=1 wins
  });

  it('tiebreaker 5: seed ascending as final tiebreaker', () => {
    const regs = [makeReg('r1', 3), makeReg('r2', 1), makeReg('r3', 2)];
    // No matches → all zeros → sort by seed
    const rows = computePoolStandings(POOL, [], regs, TFv1DefaultConfig);
    expect(rows[0]?.registrationId).toBe('r2'); // seed=1
    expect(rows[1]?.registrationId).toBe('r3'); // seed=2
    expect(rows[2]?.registrationId).toBe('r1'); // seed=3
  });

  it('voided exchanges do not affect standings', () => {
    const regs = [makeReg('r1'), makeReg('r2')];
    const voidedEx: Exchange = {
      ...makeClean('e1', 1, 'red', 2),
      voided: true,
    };
    const match = makeMatch('m1', 'r1', 'r2', [voidedEx], 'r1');
    const rows = computePoolStandings(POOL, [match], regs, TFv1DefaultConfig);
    const r1 = rows.find((r) => r.registrationId === 'r1')!;
    expect(r1.targetPoints).toBe(0); // voided exchange ignored
  });

  it('pending matches (not completed) are ignored', () => {
    const regs = [makeReg('r1'), makeReg('r2')];
    const match = {
      ...makeMatch('m1', 'r1', 'r2', [makeClean('e1', 1, 'red', 1)], 'r1'),
      status: 'running' as const,
    };
    const rows = computePoolStandings(POOL, [match], regs, TFv1DefaultConfig);
    const r1 = rows.find((r) => r.registrationId === 'r1')!;
    expect(r1.wins).toBe(0); // running match not counted
  });
});
