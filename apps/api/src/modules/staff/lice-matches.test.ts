import { describe, expect, it } from 'vitest';
import {
  LICE_MATCH_SELECT,
  LICE_MATCH_STATUSES,
  compareLiceMatchOrder,
  formatPersonName,
  mapLiceMatchRow,
  roundCodeFromMatchRow,
} from './lice-matches';

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'm1',
  status: 'scheduled',
  pool_id: null,
  scheduled_at: '2026-08-04T13:37:00Z',
  match_number_label: 'M1',
  red_score: 0,
  blue_score: 0,
  phases: {
    config_json: null,
    tournaments: { name: 'Sidesword Open', weapon: 'sidesword', scoring_config_json: null },
  },
  pools: null,
  bracket_slots: null,
  swiss_rounds: null,
  red: { persons: { given_name: 'Adrián', family_name: 'Dader Laguna' } },
  blue: { persons: { given_name: 'Valentin', family_name: 'Arrois' } },
  ...over,
});

describe('LICE_MATCH_SELECT', () => {
  it('carries what the list renders and what referee precedence needs', () => {
    // pool_id is the one column the older mappers never asked for; without it
    // a pool-scope referee can never be resolved for a match.
    for (const column of ['pool_id', 'red_score', 'blue_score', 'scoring_config_json']) {
      expect(LICE_MATCH_SELECT).toContain(column);
    }
  });
});

describe('LICE_MATCH_STATUSES', () => {
  it('includes completed and excludes voided', () => {
    // Completed is the whole point — the old endpoint filtered it out, so a
    // played bout was unreachable from the piste screen.
    expect(LICE_MATCH_STATUSES).toContain('completed');
    expect(LICE_MATCH_STATUSES).not.toContain('voided');
  });
});

describe('compareLiceMatchOrder', () => {
  it('orders by scheduled_at first', () => {
    const early = row({ scheduled_at: '2026-08-04T13:00:00Z' });
    const late = row({ scheduled_at: '2026-08-04T14:00:00Z' });
    expect(compareLiceMatchOrder(early, late)).toBeLessThan(0);
    expect(compareLiceMatchOrder(late, early)).toBeGreaterThan(0);
  });

  it('sinks unscheduled matches to the end', () => {
    const scheduled = row({ scheduled_at: '2026-08-04T13:00:00Z' });
    const unscheduled = row({ scheduled_at: null });
    expect(compareLiceMatchOrder(scheduled, unscheduled)).toBeLessThan(0);
    expect(compareLiceMatchOrder(unscheduled, scheduled)).toBeGreaterThan(0);
  });

  it('breaks ties numerically, so M2 comes before M10', () => {
    // A string sort — which is what PostgREST would apply — puts M10 first.
    const m2 = row({ match_number_label: 'L1-P1-M2' });
    const m10 = row({ match_number_label: 'L1-P1-M10' });
    expect(compareLiceMatchOrder(m2, m10)).toBeLessThan(0);
    expect([m10, m2].sort(compareLiceMatchOrder).map((r) => r['match_number_label'])).toEqual([
      'L1-P1-M2',
      'L1-P1-M10',
    ]);
  });
});

describe('roundCodeFromMatchRow', () => {
  it('builds a pool code from the pool sort order', () => {
    expect(roundCodeFromMatchRow(row({ pools: { sort_order: 1 } }))).toBe('SDW-P2-M1');
  });

  it('builds a Swiss code from the swiss round embed', () => {
    expect(roundCodeFromMatchRow(row({ swiss_rounds: { round_number: 3 } }))).toBe('SDW-S3-M1');
  });

  it('builds a bracket code from the slot round and bracket size', () => {
    const bracket = row({
      bracket_slots: { round: 2 },
      phases: {
        config_json: { bracketSize: 8 },
        tournaments: { name: 'T', weapon: 'sidesword', scoring_config_json: null },
      },
    });
    expect(roundCodeFromMatchRow(bracket)).toBe('SDW-B-SF-M1');
  });
});

describe('formatPersonName', () => {
  it('composes both halves and tolerates a missing one', () => {
    expect(formatPersonName({ given_name: 'Ana', family_name: 'Ruiz' })).toBe('Ana Ruiz');
    expect(formatPersonName({ family_name: 'Ruiz' })).toBe('Ruiz');
    expect(formatPersonName(null)).toBeNull();
    expect(formatPersonName({})).toBeNull();
  });
});

describe('mapLiceMatchRow', () => {
  it('projects the fields the piste list renders', () => {
    const mapped = mapLiceMatchRow(
      row({ status: 'completed', red_score: 7, blue_score: 3, pool_id: 'p1' }),
      ['Marc Lefevre'],
    );
    expect(mapped).toMatchObject({
      id: 'm1',
      status: 'completed',
      poolId: 'p1',
      redFighterName: 'Adrián Dader Laguna',
      blueFighterName: 'Valentin Arrois',
      redScore: 7,
      blueScore: 3,
      tournamentName: 'Sidesword Open',
      refereeNames: ['Marc Lefevre'],
    });
  });

  it('defaults absent scores to 0 rather than leaking null into the UI', () => {
    const mapped = mapLiceMatchRow(row({ red_score: null, blue_score: null }), []);
    expect(mapped.redScore).toBe(0);
    expect(mapped.blueScore).toBe(0);
  });

  it('passes the tournament scoring config through for the corner colours', () => {
    const config = { sideColors: { red: '#123456', blue: '#654321' } };
    const mapped = mapLiceMatchRow(
      row({
        phases: {
          config_json: null,
          tournaments: { name: 'T', weapon: 'sidesword', scoring_config_json: config },
        },
      }),
      [],
    );
    expect(mapped.scoringConfig).toEqual(config);
  });
});
