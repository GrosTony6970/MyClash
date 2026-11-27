import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from '@myclash/types';
import { padPointCap, venuesCounterOnPad } from './venues-pad';

const pool = { phaseType: 'pool', matchNumberLabel: 'L1-P1-M01' } as const;
const format = (unit: 'points' | 'venues'): MatchFormatConfig => ({
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  scoringUnit: unit,
  venuesPerRound: { pool: 5, bracket: 5, finals: 5 },
});

describe('the pad venues counter', () => {
  it('gives won and total in a venues bout', () => {
    expect(venuesCounterOnPad(pool, format('venues'), 3)).toEqual({ won: 3, total: 5 });
  });

  it('gives none in a points bout', () => {
    expect(venuesCounterOnPad(pool, format('points'), 3)).toBeNull();
  });
});

describe('the pad point cap', () => {
  it('is the cap in a points bout', () => {
    expect(padPointCap(format('points'))).toBe(DEFAULT_MATCH_FORMAT_CONFIG.pointCap);
  });

  it('is nothing in a venues bout', () => {
    expect(padPointCap(format('venues'))).toBeUndefined();
  });
});

describe('the pad screens', () => {
  const read = (name: string) => readFileSync(join(__dirname, '../components', name), 'utf8');

  it('MatchView gives both columns the pad cap, not the raw one', () => {
    const view = read('MatchView.tsx');
    expect(view.match(/pointCap=\{padPointCap\(matchFormat\)\}/g)).toHaveLength(2);
    expect(view).not.toContain('pointCap={matchFormat.pointCap}');
  });

  it('MatchHeader prints the counter through the venues key', () => {
    expect(read('MatchHeader.tsx')).toContain("t('scoring.rounds.venuesCounter'");
  });
});
