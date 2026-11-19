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
  locked_at: '2026-10-01T10:00:00Z',
};

export const SUMMARY = {
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
  tournamentName: 'Longsword',
  scoringConfig: null,
  phaseType: 'pool',
};

/**
 * A hit as `GET matches/:id/exchanges` hands it (`MatchesService.listExchanges`):
 * the database's own column names, plus the few aliases the pad's timeline reads
 * (`occurredAt`, `clockTimeMs`, `scoringSide`, `scoreDelta`, `defenderDelta`).
 * Seeded in camelCase, this fixture once kept the page's tests green while the
 * real page showed every hit as "? +0".
 */
const exchange = (id: string, sequence: number, voided: boolean) => ({
  id,
  sequence,
  type: 'clean',
  occurred_at: '2026-10-01T09:00:00Z',
  clock_time_ms: 30_000,
  first_striker_color: 'red',
  first_strike_value: 2,
  afterblow_value: null,
  no_exchange_reason: null,
  red_score_delta: 2,
  blue_score_delta: 0,
  voided,
  voided_reason: voided ? 'Wrong fighter' : null,
  client_uuid: `uuid-${id}`,
  occurredAt: '2026-10-01T09:00:00Z',
  clockTimeMs: 30_000,
  scoringSide: 'red',
  scoreDelta: 2,
  defenderDelta: null,
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
  score_policy: 'keep_current',
  note: null,
  parent_forfeit_id: null,
  auto_created: false,
};

/** The Tournament's forfeit questions (`/match-config`): a penalty ruleset's club start. */
export const CLUB_START_ASKS = { injury: true, voluntary: true, conduct_violation: false };

export function boutReads(bout: object, forfeit: object | null): Record<string, unknown> {
  return {
    '/api/v1/matches/m1': bout,
    '/api/v1/matches/m1/summary': SUMMARY,
    '/api/v1/tournaments/t-1/match-config': { forfeitAsks: CLUB_START_ASKS },
    '/api/v1/matches/m1/exchanges': [exchange('ex-1', 1, false), exchange('ex-2', 2, true)],
    '/api/v1/matches/m1/audit-log?limit=50': [],
    '/api/v1/matches/m1/forfeit': forfeit,
    '/api/v1/matches/m1/uncomplete-preflight': PREFLIGHT,
  };
}
