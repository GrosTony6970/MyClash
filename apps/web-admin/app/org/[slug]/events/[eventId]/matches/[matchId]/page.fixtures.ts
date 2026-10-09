/**
 * The reads of the bout page, for its page-level tests. The bout's row is seeded
 * as the API hands it: the database's own column names (`locked_at`).
 */
export const BOUT = {
  id: 'm1',
  match_number_label: 'L1-P1-M01',
  status: 'completed',
  red_score: 5,
  blue_score: 3,
  red_registration_id: 'reg-red',
  blue_registration_id: 'reg-blue',
  ruleset_code: 'TF_v1',
  locked_at: '2026-10-01T10:00:00Z',
};

const SUMMARY = {
  matchLabel: 'L1-P1-M01',
  roundCode: 'LSW-P1-M01',
  status: 'completed',
  poolName: 'Pool 1',
  redName: 'Ana Roux',
  redClub: null,
  blueName: 'Bo Lund',
  blueClub: null,
  weapon: 'Longsword',
  tournamentId: 't-1',
  scoringConfig: null,
  phaseType: 'pool',
};

const exchange = (id: string, sequence: number, voided: boolean) => ({
  id,
  sequence,
  type: 'clean',
  occurredAt: '2026-10-01T09:00:00Z',
  firstStrikerColor: 'red',
  firstStrikeValue: 1,
  afterblowValue: null,
  noExchangeReason: null,
  redScoreDelta: 1,
  blueScoreDelta: 0,
  voided,
  voidedReason: voided ? 'Wrong fighter' : null,
  clientUuid: `uuid-${id}`,
});

/** A reopen the server would carry out: nothing later was fought. */
const PREFLIGHT = {
  affected: [],
  foughtCount: 0,
  blocked: false,
  canDiscard: false,
  frozen: false,
};

export const FORFEIT_RECORD = {
  id: 'f-1',
  reason: 'injury',
  forfeiting_score: null,
  opponent_score: null,
  note: null,
  parent_forfeit_id: null,
  auto_created: false,
};

export function boutReads(bout: object, forfeit: object | null): Record<string, unknown> {
  return {
    '/api/v1/matches/m1': bout,
    '/api/v1/matches/m1/summary': SUMMARY,
    '/api/v1/matches/m1/exchanges': [exchange('ex-1', 1, false), exchange('ex-2', 2, true)],
    '/api/v1/matches/m1/audit-log?limit=50': [],
    '/api/v1/matches/m1/forfeit': forfeit,
    '/api/v1/matches/m1/uncomplete-preflight': PREFLIGHT,
  };
}
