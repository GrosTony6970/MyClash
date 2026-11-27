import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG } from '@myclash/types';
import type { ExchangeRow } from '../types/match-events';
import type { DisplayMatch } from '../hooks/useLiveMatch';
import { TVHeader } from './TVScoreboard';

const say = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${Object.values(values).join('/')}` : key;

function clean(n: number, round: number): ExchangeRow {
  return {
    id: `e${n}`,
    sequence: n,
    type: 'clean',
    voided: false,
    occurredAt: '2027-06-21T10:00:00.000Z',
    clockTimeMs: n * 1000,
    scoringSide: n % 2 ? 'red' : 'blue',
    scoreDelta: 1,
    defenderDelta: null,
    round_number: round,
  };
}

function header(unit: 'points' | 'venues', exchanges: ExchangeRow[]) {
  const match = {
    id: 'm1',
    phaseType: 'pool',
    matchNumberLabel: 'L1-P1-M01',
    currentRound: 1,
    matchFormat: {
      ...DEFAULT_MATCH_FORMAT_CONFIG,
      scoringUnit: unit,
      venuesPerRound: { pool: 5, bracket: 5, finals: 5 },
    },
  } as unknown as DisplayMatch;
  return renderToStaticMarkup(
    <TVHeader
      match={match}
      redName="Red"
      blueName="Blue"
      redBorder="#cc0000"
      blueBorder="#0000cc"
      exchanges={exchanges}
      t={say}
    />,
  );
}

describe('TVHeader venues counter', () => {
  const three = [clean(1, 1), clean(2, 1), clean(3, 1), clean(4, 2)];

  it('shows won/total of the current round in a venues bout', () => {
    expect(header('venues', three)).toContain('scoring.rounds.venuesCounter 3/5');
  });

  it('shows no venues counter in a points bout', () => {
    expect(header('points', three)).not.toContain('venuesCounter');
  });
});
