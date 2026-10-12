import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { runContext } from './_context';
import type { Api } from './_api';
import { createBracketTournament, ensurePersons, openForScoring, type Person } from './_bracket';

/**
 * One bout to score against, and the reads of it: what the API-driven specs of
 * the scoring pad share (`10-scoring-pad.spec.ts`, `39-late-presses.spec.ts`).
 */

/** Low cap so a match completes in few exchanges; also a realistic HEMA value. */
export const POINT_CAP = 5;

export interface MatchRow {
  id: string;
  status: string;
  red_score: number | null;
  blue_score: number | null;
  winner_registration_id: string | null;
  end_reason: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
  /** Best-of state. `red_score`/`blue_score` track the OPEN round, not the series. */
  current_round?: number | null;
  rounds_json?: unknown;
  red_round_wins?: number | null;
  blue_round_wins?: number | null;
  awaiting_round_advance?: boolean | null;
}

/**
 * A single playable match to score against.
 *
 * Built as a 2-fighter double-elim bracket: the smallest shape that yields one
 * real match row wired to a phase and a ruleset, with no pools to finish first.
 * Each test gets its own so a completed match never leaks into the next case.
 */
export async function aMatch(
  api: Api,
  key: string,
  opts: {
    afterblowMode?: 'full' | 'deductive';
    bestOf?: { pool: number; bracket: number; finals: number };
    /** 0 = no limit, so `timeIsFinished` is true at once and the level-at-time
     *  chain can be driven without waiting out a real phase clock. */
    timeLimitsSeconds?: { pool: number; bracket: number; finals: number };
  } = {},
): Promise<{
  tournamentId: string;
  matchId: string;
  redRegistrationId: string;
  blueRegistrationId: string;
}> {
  const { eventId } = runContext();
  const roster: Person[] = await ensurePersons(api, eventId, 2);
  const token = `${key}-${Date.now().toString(36)}`;

  const tournament = await createBracketTournament(api, eventId, {
    name: `Pad ${key}`,
    slug: `pad-${token}`,
    fighters: roster.slice(0, 2),
  });

  // pointCap must go through a PATCH: createTournament only started honouring
  // rulesetConfig recently, and afterblowMode lives on scoringConfig.
  await api.ok(
    await api.patch(`tournaments/${tournament.id}`, {
      data: {
        rulesetConfig: {
          matchFormat: {
            pointCap: POINT_CAP,
            ...(opts.bestOf ? { bestOf: opts.bestOf } : {}),
            ...(opts.timeLimitsSeconds ? { timeLimitsSeconds: opts.timeLimitsSeconds } : {}),
          },
        },
        ...(opts.afterblowMode ? { scoringConfig: { afterblowMode: opts.afterblowMode } } : {}),
      },
    }),
  );

  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-bracket`, {
      data: { phaseType: 'double_elim', qualifyCount: 2 },
    }),
  );
  await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));

  const bracket = await api.json<{
    slots: Array<{
      round: number;
      matchId: string | null;
      redRegistrationId: string | null;
      blueRegistrationId: string | null;
    }>;
  }>(await api.get(`tournaments/${tournament.id}/bracket`));

  const slot = bracket.slots.find(
    (s) => s.round === 1 && s.matchId && s.redRegistrationId && s.blueRegistrationId,
  );
  expect(slot, `no playable round-1 match for ${key}`).toBeDefined();

  return {
    tournamentId: tournament.id,
    matchId: slot!.matchId as string,
    redRegistrationId: slot!.redRegistrationId as string,
    blueRegistrationId: slot!.blueRegistrationId as string,
  };
}

let sequence = 0;

/** The next sequence number of this run: each exchange takes a new one. */
export const nextSequence = (): number => ++sequence;

/** Post one exchange the way the pad does, and return the created row. */
export async function hit(
  api: Api,
  matchId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  await openForScoring(api, matchId);
  return api.json<{ id: string }>(
    await api.post(`matches/${matchId}/exchanges`, {
      data: {
        clientUuid: randomUUID(),
        sequence: ++sequence,
        occurredAt: new Date().toISOString(),
        clockTimeMs: sequence * 5_000,
        ...body,
      },
    }),
  );
}

export const readMatch = async (api: Api, matchId: string): Promise<MatchRow> =>
  api.json<MatchRow>(await api.get(`matches/${matchId}`));

/** Assert the PERSISTED score equals what the engine should have derived. */
export async function expectScore(
  api: Api,
  matchId: string,
  red: number,
  blue: number,
): Promise<void> {
  const match = await api.json<MatchRow>(await api.get(`matches/${matchId}`));
  expect({ red: match.red_score, blue: match.blue_score }).toEqual({ red, blue });
}

export async function clockMs(api: Api, matchId: string): Promise<number> {
  const state = await api.json<{ totalActiveMs: number }>(
    await api.get(`matches/${matchId}/clock`),
  );
  return state.totalActiveMs;
}
