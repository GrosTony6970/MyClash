import { vi } from 'vitest';
import type { TournamentContext } from './tournament-query.types';

// Shared fixtures of the tool service tests.
export function awaitableChain(result: { data: unknown; error: unknown }) {
  const chain = Object.assign(Promise.resolve(result), {}) as Record<string, unknown> &
    Promise<typeof result>;
  for (const key of ['select', 'eq', 'in', 'or', 'order', 'limit']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

// Real UUIDs, so a leaked id is one expectNoRawIds can see.
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const POOL_A = uuid(1);
export const POOL_B = uuid(2);
export const REG_ADA = uuid(11);
export const REG_GRACE_H = uuid(12);
export const REG_GRACE_M = uuid(13);
export const REG_LONELY = uuid(14);
export const GP_JEAN = uuid(21);
export const GP_MARIE = uuid(22);
export const M1 = uuid(31);
export const M2 = uuid(32);
export const M3 = uuid(33);

export const tournament: TournamentContext = {
  tournamentId: uuid(100),
  eventId: uuid(101),
  organizationId: uuid(102),
  name: 'Longsword Open',
  weapon: 'longsword',
  weapons: ['longsword'],
  poolNames: ['Pool A'],
  liceNumbers: [1],
  divisions: [],
};

// The projection vw_tournament_query_referees actually has, confirmed against a
// replayed database: 0063 replaced user_id with person_id. Nothing here may
// carry a user_id field — a fixture that invents one cannot catch the bug that
// made this tool return "no assignments" for every judge.
export const refereeRows = [
  {
    tournament_id: tournament.tournamentId,
    event_id: tournament.eventId,
    person_id: GP_JEAN,
    judge_name: 'Jean Dupont',
    pool_id: POOL_A,
    pool_name: 'Pool A',
    match_id: M1,
    role: 'arbitre_declarant',
    status: 'confirmed',
  },
  {
    tournament_id: tournament.tournamentId,
    event_id: tournament.eventId,
    person_id: GP_JEAN,
    judge_name: 'Jean Dupont',
    pool_id: POOL_B,
    pool_name: 'Pool B',
    match_id: M2,
    role: 'arbitre_assesseur',
    status: 'confirmed',
  },
  {
    tournament_id: tournament.tournamentId,
    event_id: tournament.eventId,
    person_id: GP_MARIE,
    judge_name: 'Marie Martin',
    pool_id: POOL_A,
    pool_name: 'Pool A',
    match_id: null,
    role: 'arbitre_table',
    status: 'confirmed',
  },
];

export const fighterRows = [
  {
    registration_id: REG_ADA,
    person_id: uuid(41),
    display_name: 'Ada Lovelace',
    club_name: 'Alpha',
    status: 'registered',
  },
  {
    registration_id: REG_GRACE_H,
    person_id: uuid(42),
    display_name: 'Grace Hopper',
    club_name: 'Beta',
    status: 'registered',
  },
  {
    registration_id: REG_GRACE_M,
    person_id: uuid(43),
    display_name: 'Grace Murray',
    club_name: null,
    status: 'registered',
  },
];

export const poolBout = (matchId: string, red: string, blue: string, extra = {}) => ({
  tournament_id: tournament.tournamentId,
  match_id: matchId,
  phase_type: 'pool',
  pool_id: POOL_A,
  pool_name: 'Pool A',
  lice_name: 'Lice 1',
  lice_number: 1,
  red_registration_id: red,
  blue_registration_id: blue,
  red_name: red === REG_ADA ? 'Ada Lovelace' : 'Grace Hopper',
  blue_name: blue === REG_ADA ? 'Ada Lovelace' : 'Grace Hopper',
  red_score: 2,
  blue_score: 1,
  winner_registration_id: red,
  status: 'completed',
  match_number_label: null,
  ...extra,
});
