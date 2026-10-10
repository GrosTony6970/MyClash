import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG, type MatchFormatConfig } from '@myclash/types';
import type { ExchangeRow } from '@myclash/ui';
import { padSeries } from './pad-series';

const FORMAT: MatchFormatConfig = { ...DEFAULT_MATCH_FORMAT_CONFIG, maxDoubleHits: 3 };

let next = 1;
/** A row of the server's list, in the shape `GET /matches/:id/exchanges` gives. */
function row(type: ExchangeRow['type'], round?: number | null): ExchangeRow {
  const id = `x${next++}`;
  return {
    id,
    client_uuid: id,
    sequence: next,
    type,
    voided: false,
    occurredAt: '2026-10-10T10:00:00.000Z',
    ...(round === undefined ? {} : { round_number: round }),
  };
}
const queued = (type: ExchangeRow['type']): ExchangeRow => ({ ...row(type), pending: true });

const BEST_OF_3 = { isBestOf: true, phaseType: 'pool' as const, matchFormat: FORMAT };

describe('padSeries: the doubles of the open round', () => {
  it('counts the doubles of the open round only, as the server does', () => {
    const series = padSeries({
      ...BEST_OF_3,
      currentRound: 2,
      exchanges: [row('double', 1), row('double', 1), row('clean', 2), row('double', 2)],
      queued: [],
    });
    expect(series).toEqual({ round: 2, doubles: 1, doublesLimit: 3 });
  });

  it('adds the doubles the tablet still holds: they are of the open round', () => {
    const series = padSeries({
      ...BEST_OF_3,
      currentRound: 2,
      exchanges: [row('double', 1), row('double', 2)],
      queued: [queued('double'), queued('clean')],
    });
    expect(series.doubles).toBe(2);
  });

  it('reads a row with no round as round 1, as the server does', () => {
    const rows = [row('double'), row('double', null)];
    expect(padSeries({ ...BEST_OF_3, currentRound: 1, exchanges: rows, queued: [] }).doubles).toBe(
      2,
    );
    expect(padSeries({ ...BEST_OF_3, currentRound: 2, exchanges: rows, queued: [] }).doubles).toBe(
      0,
    );
  });

  it('counts every double of a single-round bout, whatever its rows say', () => {
    const series = padSeries({
      isBestOf: false,
      phaseType: 'pool',
      matchFormat: FORMAT,
      currentRound: 1,
      exchanges: [row('double', 1), row('double', 2), row('double')],
      queued: [queued('double')],
    });
    expect(series).toEqual({ round: 1, doubles: 4, doublesLimit: 3 });
  });
});

describe('padSeries: the doubles limit that applies', () => {
  const at = (phaseType: Parameters<typeof padSeries>[0]['phaseType']) =>
    padSeries({ ...BEST_OF_3, phaseType, currentRound: 1, exchanges: [], queued: [] }).doublesLimit;

  it("is the format's limit in a pool and in a Swiss round", () => {
    expect(at('pool')).toBe(3);
    expect(at('swiss')).toBe(3);
  });

  it('is none in a bracket, and for a bout whose phase is not known: the server applies none', () => {
    expect(at('single_elim')).toBeNull();
    expect(at('double_elim')).toBeNull();
    expect(at(undefined)).toBeNull();
  });

  it('is none when the format has none', () => {
    const series = padSeries({
      ...BEST_OF_3,
      matchFormat: { ...FORMAT, maxDoubleHits: null },
      currentRound: 1,
      exchanges: [],
      queued: [],
    });
    expect(series.doublesLimit).toBeNull();
  });
});
