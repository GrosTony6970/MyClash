import { expect } from '@playwright/test';
import { sleep, type Api } from './_api';
import { createBracketTournament, scoreMatch, POINT_CAP, type Person } from './_bracket';

/**
 * Build and play a POOL phase over the real API.
 *
 * `_bracket.ts` deliberately creates pool-less tournaments — with no pool phase
 * `populateBracket` takes the registration-seed path, which is what makes a
 * bracket spec's draw deterministic. Two things this wave shipped are only
 * reachable through pools, so they need the other shape:
 *
 *   - **seeding drift** exists precisely because a pool result can change after
 *     the bracket was seeded from it (`34-seeding-drift.spec.ts`);
 *   - a **cascading forfeit** auto-forfeits the fighter's remaining POOL bouts
 *     and nothing else (`35-forfeit-cascade.spec.ts`).
 *
 * The convention matches `_bracket.ts`: fighters are registered seeded 1..N and
 * **the lower seed wins every bout**, so each pool's standings come out in seed
 * order and every assertion downstream can be exact rather than "something
 * changed". Deliberately free of workspace-package imports, like its siblings.
 */

export interface PoolTournament {
  id: string;
  fighters: Person[];
  /** personId → the registration created for it, in seed order. */
  registrationIdByPersonId: Map<string, string>;
  /** registrationId → the 1-based seed it was registered with. */
  seedByRegistrationId: Map<string, number>;
}

/** One pool bout, as `GET /tournaments/:id/pools-with-matches` projects it. */
export interface PoolMatch {
  id: string;
  status: string;
  red_registration_id: string | null;
  blue_registration_id: string | null;
}

interface PoolWithMatches {
  poolId: string;
  matches?: PoolMatch[];
}

/** One row of `GET /tournaments/:id/pool-standings`. */
export interface StandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
}

/**
 * A tournament with `poolCount` pools over `fighters`, nothing played yet.
 *
 * Reuses `createBracketTournament` for the tournament + registrations + point
 * cap — the only difference between the two shapes is what comes next, and
 * duplicating registration bookkeeping is how the two would drift apart.
 */
export async function createPoolTournament(
  api: Api,
  eventId: string,
  opts: { name: string; slug: string; fighters: Person[]; poolCount: number },
): Promise<PoolTournament> {
  const tournament = await createBracketTournament(api, eventId, {
    name: opts.name,
    slug: opts.slug,
    fighters: opts.fighters,
  });

  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-pools`, {
      data: {
        poolCount: opts.poolCount,
        // Both off: the roster is synthetic and clubless, and either constraint
        // could reshuffle who lands in which pool, which is exactly the thing
        // these specs need to stay predictable.
        enforceSchoolSeparation: false,
        enforceSkillBalance: false,
      },
    }),
  );

  const registrationIdByPersonId = new Map<string, string>();
  const seedByRegistrationId = new Map<string, number>();
  for (const [registrationId, person] of tournament.personByRegistrationId) {
    registrationIdByPersonId.set(person.id, registrationId);
    seedByRegistrationId.set(
      registrationId,
      opts.fighters.findIndex((f) => f.id === person.id) + 1,
    );
  }

  return {
    id: tournament.id,
    fighters: opts.fighters,
    registrationIdByPersonId,
    seedByRegistrationId,
  };
}

/** Every pool bout of this tournament, flattened across its pools. */
export async function readPoolMatches(api: Api, tournamentId: string): Promise<PoolMatch[]> {
  const pools = await api.json<PoolWithMatches[]>(
    await api.get(`tournaments/${tournamentId}/pools-with-matches`),
  );
  return pools.flatMap((pool) => pool.matches ?? []);
}

/**
 * Play every unplayed pool bout, lower seed winning.
 *
 * Returns the bouts it played. A bye (one side null) and an already-completed
 * bout are both skipped, so this is safe to call again after a reset.
 */
export async function playPoolPhase(
  api: Api,
  tournament: PoolTournament,
): Promise<{ played: PoolMatch[] }> {
  const played: PoolMatch[] = [];
  for (const match of await readPoolMatches(api, tournament.id)) {
    if (match.status === 'completed') continue;
    const winnerColor = lowerSeedColor(tournament, match);
    if (!winnerColor) continue;
    await scoreMatch(api, match.id, winnerColor, POINT_CAP);
    played.push(match);
  }
  return { played };
}

/**
 * Which side of this bout holds the lower seed, or null when it is not a real
 * pairing (a bye, or a side this tournament did not register).
 */
export function lowerSeedColor(
  tournament: PoolTournament,
  match: Pick<PoolMatch, 'red_registration_id' | 'blue_registration_id'>,
): 'red' | 'blue' | null {
  const red = match.red_registration_id;
  const blue = match.blue_registration_id;
  if (!red || !blue) return null;
  const redSeed = tournament.seedByRegistrationId.get(red);
  const blueSeed = tournament.seedByRegistrationId.get(blue);
  if (redSeed === undefined || blueSeed === undefined) return null;
  return redSeed < blueSeed ? 'red' : 'blue';
}

/** The side of this bout holding `registrationId`, or null when it is neither. */
export function colorOf(
  match: Pick<PoolMatch, 'red_registration_id' | 'blue_registration_id'>,
  registrationId: string,
): 'red' | 'blue' | null {
  if (match.red_registration_id === registrationId) return 'red';
  if (match.blue_registration_id === registrationId) return 'blue';
  return null;
}

/** The tournament-wide standings, best first. */
export async function readOverallStandings(
  api: Api,
  tournamentId: string,
): Promise<StandingsRow[]> {
  const body = await api.json<{ rows?: StandingsRow[] }>(
    await api.get(`tournaments/${tournamentId}/pool-standings?mode=overall`),
  );
  return body.rows ?? [];
}

export interface PoolStandings {
  poolId: string;
  poolName: string;
  /** `completed` for every pool is the gate `populateBracket` waits on. */
  status: string;
  rows: StandingsRow[];
}

/** Per-pool standings, each pool's rows already ranked. */
export async function readPoolStandings(api: Api, tournamentId: string): Promise<PoolStandings[]> {
  const body = await api.json<{ pools?: PoolStandings[] }>(
    await api.get(`tournaments/${tournamentId}/pool-standings?mode=by-pool`),
  );
  return body.pools ?? [];
}

/**
 * The bout between a pool's top two, and which side its runner-up is on.
 *
 * WITHIN one pool on purpose. Pool assignment spreads the seeds for balance, so
 * the two fighters at the top of the OVERALL standings are usually in different
 * pools and never met — there would be no single result to flip. Two fighters in
 * the same pool always played each other exactly once.
 */
export async function poolDecider(
  api: Api,
  tournament: PoolTournament,
): Promise<{
  matchId: string;
  leaderId: string;
  runnerUpId: string;
  runnerUpColor: 'red' | 'blue';
}> {
  const pools = await readPoolStandings(api, tournament.id);
  const pool = pools.find((p) => p.rows.length >= 2);
  expect(pool, 'no pool has two ranked fighters to decide between').toBeTruthy();
  const leaderId = pool!.rows[0]!.registrationId;
  const runnerUpId = pool!.rows[1]!.registrationId;

  const bout = (await readPoolMatches(api, tournament.id)).find(
    (m) =>
      (m.red_registration_id === leaderId && m.blue_registration_id === runnerUpId) ||
      (m.red_registration_id === runnerUpId && m.blue_registration_id === leaderId),
  );
  expect(bout, "a pool's top two must have met — round robin guarantees it").toBeTruthy();
  const runnerUpColor = colorOf(bout!, runnerUpId);
  expect(runnerUpColor, 'the runner-up is on neither side of their own bout').toBeTruthy();

  return { matchId: bout!.id, leaderId, runnerUpId, runnerUpColor: runnerUpColor! };
}

/** Where `registrationId` sits in these standings, or -1. */
export const rankOf = (rows: StandingsRow[], registrationId: string): number =>
  rows.findIndex((row) => row.registrationId === registrationId);

/**
 * Put a completed bout back in play.
 *
 * `POST /matches/:id/reset` is the door the match page actually offers: it voids
 * the exchanges, clears the winner and returns the row to `scheduled` with
 * `started_at` null. That last part is what both features under test read —
 * the pool gate re-opens, and `hasStarted` stops blocking a re-seed.
 */
export async function resetMatch(api: Api, matchId: string, reason: string): Promise<void> {
  await api.ok(
    await api.post(`matches/${matchId}/reset`, {
      data: { confirmation: 'RESET MATCH', reason },
    }),
  );
}

/**
 * Poll `read` until `accept` is happy, then return that value.
 *
 * Several things this wave touches are fire-and-forget on the server —
 * completing the last pool bout kicks off an auto-populate that the API does not
 * wait for — so a read taken immediately after a write can legitimately be one
 * state behind. Fails with the last value seen rather than a bare timeout, so a
 * wrong state reads as itself instead of as "flaky".
 */
export async function poll<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  what: string,
  tries = 20,
  delayMs = 500,
): Promise<T> {
  let last = await read();
  for (let i = 0; i < tries && !accept(last); i++) {
    await sleep(delayMs);
    last = await read();
  }
  expect(accept(last), `${what} — last seen: ${JSON.stringify(last)}`).toBe(true);
  return last;
}
