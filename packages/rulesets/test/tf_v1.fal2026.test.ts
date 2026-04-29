/**
 * T-204 · TF_v1 golden test — FAL 2026
 *
 * Verifies that the TF_v1 score formula reproduces the published pool standings
 * from https://lyonamhe.fr/resultat_fal2026.html to one decimal place.
 *
 * Data source: aggregate-level data scraped from the published results page.
 * Per-exchange sequences are not yet available (O-102 pending).
 * When per-exchange data becomes available, this test will be upgraded to
 * verify byte-for-byte reproduction from raw exchanges.
 *
 * AGENTS.md hard rule #2: this test is sacred. If it fails, fix the engine.
 * Do NOT adjust the expected values to match a broken implementation.
 */
import { describe, it, expect } from 'vitest';
import { computeScore, doublePenalty } from '../src/tf_v1/score';
import fixture from './fixtures/fal2026.json';

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Compute TF_v1 score from aggregate values and round to 1 decimal.
 * This mirrors what the engine does when given per-exchange data.
 */
function scoreFromAggregates(wins: number, ptsPlus: number, ptsMinus: number, doubles: number): number {
  const agg = { wins, targetPoints: ptsPlus, timesHit: ptsMinus, doubles };
  const raw = computeScore(agg);
  return Math.round(raw * 10) / 10;
}

// ── Longsword pool standings (54 fighters) ────────────────────────────────────

describe('TF_v1 golden test — FAL 2026 Longsword (54 fighters)', () => {
  for (const row of fixture.longsword.pool_standings) {
    it(`${row.name}: V=${row.wins} Pts+=${row.pts_plus} Pts−=${row.pts_minus} Dbl=${row.doubles} → Score=${row.score}`, () => {
      const computed = scoreFromAggregates(row.wins, row.pts_plus, row.pts_minus, row.doubles);
      expect(computed).toBe(row.score);
    });
  }
});

// ── Sidesword pool standings (18 fighters) ────────────────────────────────────

describe('TF_v1 golden test — FAL 2026 Sidesword (18 fighters)', () => {
  for (const row of fixture.sidesword.pool_standings) {
    it(`${row.name}: V=${row.wins} Pts+=${row.pts_plus} Pts−=${row.pts_minus} Dbl=${row.doubles} → Score=${row.score}`, () => {
      const computed = scoreFromAggregates(row.wins, row.pts_plus, row.pts_minus, row.doubles);
      expect(computed).toBe(row.score);
    });
  }
});

// ── §6.4 reference spot-check ─────────────────────────────────────────────────

describe('§6.4 reference spot-check', () => {
  it('Thibaud Jacquier-Bret: SCORE = (4×3+37)/(10+2×1/3) ≈ 4.59 → 4.6', () => {
    // ARCHITECTURE.md §6.4 explicit cross-check
    const numerator = 4 * 3 + 37; // 49
    const denominator = 10 + doublePenalty(2); // 10 + 2/3 ≈ 10.667
    const raw = numerator / denominator;
    expect(Math.round(raw * 10) / 10).toBe(4.6);
    expect(scoreFromAggregates(4, 37, 10, 2)).toBe(4.6);
  });
});
