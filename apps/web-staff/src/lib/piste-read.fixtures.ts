/** A piste of three bouts as `GET /staff/lices/:liceId/bouts` answers it, for the tests of its read. */

export const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  match_number_label: 'M3',
  status: 'scheduled',
  ruleset_code: 'TF',
  ruleset_version: '1.0.0',
  red_registration_id: `red-${id}`,
  blue_registration_id: `blue-${id}`,
  red_score: 0,
  blue_score: 0,
  winner_registration_id: null,
  locked_at: null,
  lice_id: 'lice-1',
  end_reason: null,
  current_round: 1,
  red_round_wins: 0,
  blue_round_wins: 0,
  rounds_json: null,
  awaiting_round_advance: false,
  ...over,
});

export const summary = (id: string, tournamentId = 'tournament-1') => ({
  roundCode: `LSW-P1-${id}`,
  redName: `Red ${id}`,
  blueName: `Blue ${id}`,
  redClub: 'Club A',
  blueClub: null,
  weapon: 'longsword',
  tournamentId,
  tournamentName: 'Longsword Open',
  poolName: 'Pool 1',
  liceName: 'Piste 2',
  phaseType: 'pool',
  bestOf: 1,
});

/** Bout 2 is of another Tournament; bout 3 has no summary. */
export const PISTE = {
  liceId: 'lice-1',
  liceName: 'Piste 2',
  bouts: [
    { match: row('bout-1', { status: 'running', red_score: 3 }), summary: summary('bout-1') },
    { match: row('bout-2'), summary: summary('bout-2', 'tournament-2') },
    { match: row('bout-3'), summary: null },
  ],
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
