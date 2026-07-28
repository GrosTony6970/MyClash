import type { APIRequestContext, APIResponse } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Points needed to win a match. Set on every tournament this module creates, so
 * the engine's `first_to_points` completion is what ends each bracket match.
 * 5 is a realistic HEMA cap and keeps the exchange count (and so the request
 * count) low — a 10-cap would roughly double both.
 */
export const POINT_CAP = 5;

/**
 * Helpers for building and playing a bracket phase end-to-end over the real API.
 *
 * Written for the double-elimination spec (`09-double-elim.spec.ts`), which is
 * the one format where an integration test earns its keep: `BracketAdvanceService`
 * advances fighters by matching REF STRINGS, not by walking foreign keys. The
 * generator writes `source_a_ref: 'loser of WBR1P3'`; on completion `buildSelfRef`
 * stamps the finished slot as `WBR1P3`. If those two strings disagree by one
 * character nothing fills the downstream slot, NOTHING THROWS, and the tournament
 * stalls permanently (see `apps/api/src/modules/phases/bracket-refs.ts`). Only a
 * real playthrough against real rows catches that.
 *
 * Matches are played the way a scorekeeper actually plays them: clean exchanges
 * are posted until one side reaches the point cap, and the ruleset engine
 * completes the match and decides the winner. An earlier version declared the
 * winner with `PATCH /matches/:id/status` — which is faster, but tests a door no
 * real user opens: no frontend calls that endpoint, and completing a match
 * through it was the ONLY non-forfeit path that advanced a bracket. Driving the
 * real path is what proves the pad's own completion advances anything.
 *
 * `populateBracket` seeds straight from registrations when the tournament has no
 * pool phase, so a bracket test needs no pools and no pool matches.
 *
 * Deliberately NOT built on `07-populate-event.spec.ts`'s helpers: those are
 * entangled with clock / exchange / penalty / live-demo concerns this spec does
 * not want. Also deliberately free of workspace-package imports, matching the
 * convention that file documents — the e2e runner resolves them poorly.
 */

type RequestOptions = Parameters<APIRequestContext['post']>[1];

/** Pace writes under the API's per-IP throttle from a non-whitelisted network. */
const PACE_MS = Number(process.env.E2E_PACE_MS ?? '0') || 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Api {
  get: (path: string) => Promise<APIResponse>;
  post: (path: string, options?: RequestOptions) => Promise<APIResponse>;
  patch: (path: string, options?: RequestOptions) => Promise<APIResponse>;
  /** Throws with status + body when the response isn't 2xx. */
  ok: (res: APIResponse) => Promise<APIResponse>;
  /** `ok()` then parse the body. */
  json: <T>(res: APIResponse) => Promise<T>;
}

/** Wrap a Playwright request context with the `/api/v1` prefix + pacing. */
export function apiFor(request: APIRequestContext): Api {
  let lastAt = 0;
  const paced = async <T>(fn: () => Promise<T>): Promise<T> => {
    const wait = lastAt + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    return fn();
  };
  const url = (path: string) => `/api/v1/${path}`;

  const ok = async (res: APIResponse): Promise<APIResponse> => {
    if (!res.ok()) {
      throw new Error(`${res.url()} → ${res.status()}: ${(await res.text()).slice(0, 300)}`);
    }
    return res;
  };

  return {
    get: (path) => paced(() => request.get(url(path))),
    post: (path, options) => paced(() => request.post(url(path), options)),
    patch: (path, options) => paced(() => request.patch(url(path), options)),
    ok,
    json: async <T>(res: APIResponse): Promise<T> => (await (await ok(res)).json()) as T,
  };
}

// ── People ───────────────────────────────────────────────────────────────────

export interface Person {
  id: string;
  givenName: string;
  familyName: string;
}

/** Display name exactly as the bracket + final-ranking surfaces render it. */
export const personName = (p: Person) => `${p.givenName} ${p.familyName}`.trim();

/**
 * Idempotently provide `count` fighters named `Seed 01 … Seed NN` on the event.
 *
 * One person may register in several tournaments of the same event, so all four
 * scenarios share this one roster. Idempotent so a rerun against a PRESERVED
 * test event (the `global-teardown` default) doesn't duplicate people.
 */
export async function ensurePersons(api: Api, eventId: string, count: number): Promise<Person[]> {
  const familyOf = (n: number) => String(n).padStart(2, '0');
  const existing = await api.json<Person[]>(await api.get(`events/${eventId}/persons`));
  const byFamily = new Map(
    existing.filter((p) => p.givenName === 'Seed').map((p) => [p.familyName, p]),
  );

  const people: Person[] = [];
  for (let n = 1; n <= count; n++) {
    const family = familyOf(n);
    const found = byFamily.get(family);
    if (found) {
      people.push(found);
      continue;
    }
    people.push(
      await api.json<Person>(
        await api.post(`events/${eventId}/persons`, {
          data: { givenName: 'Seed', familyName: family },
        }),
      ),
    );
  }
  return people;
}

// ── Tournament ───────────────────────────────────────────────────────────────

export interface BracketTournament {
  id: string;
  /** registrationId → the person behind it, for name assertions. */
  personByRegistrationId: Map<string, Person>;
}

/**
 * Create a tournament and register `fighters` into it, seeded 1..N in order.
 *
 * Creates NO pools on purpose: with no pool phase, `populateBracket` takes the
 * registration-seed path (`rankBySeed`), so rank K == the seed we set here ==
 * the bracket side labelled `seed K`. That is what makes the draw — and so the
 * expected champion — deterministic.
 */
export async function createBracketTournament(
  api: Api,
  eventId: string,
  opts: { name: string; slug: string; fighters: Person[] },
): Promise<BracketTournament> {
  const tournament = await api.json<{ id: string }>(
    await api.post(`events/${eventId}/tournaments`, {
      data: {
        name: opts.name,
        slug: opts.slug,
        weapon: 'longsword',
        color: 'red',
        // Pin the point cap so `scoreMatch` knows exactly how many points end a
        // match. Without it the default (10) applies and the arithmetic below
        // would overshoot or never trip completion.
        rulesetConfig: { matchFormat: { pointCap: POINT_CAP } },
      },
    }),
  );

  const personByRegistrationId = new Map<string, Person>();
  for (const [index, person] of opts.fighters.entries()) {
    const registration = await api.json<{ id: string }>(
      await api.post(`tournaments/${tournament.id}/registrations`, {
        data: { personId: person.id, seed: index + 1 },
      }),
    );
    personByRegistrationId.set(registration.id, person);
  }

  return { id: tournament.id, personByRegistrationId };
}

// ── Bracket ──────────────────────────────────────────────────────────────────

/** One slot of `GET /tournaments/:id/bracket` (see `phases.service.ts` enrichedSlots). */
export interface BracketSlot {
  id: string;
  round: number;
  position: number;
  status: string;
  matchId: string | null;
  winnerRegistrationId: string | null;
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  redScore: number | null;
  blueScore: number | null;
  source_a_ref: string | null;
  source_b_ref: string | null;
}

/** The bracket summary + its projected `config_json` (same file, `getTournamentBracket`). */
export interface Bracket {
  phaseId: string;
  phaseType: string;
  totalSlots: number;
  bracketSize: number;
  fighterCount: number;
  wbRounds: number | null;
  lbRounds: number | null;
  hasPlayInRound: boolean;
  playInMatchCount: number;
  grandFinalReset: boolean;
  secondChanceTarget: 'gold' | 'bronze';
  bronzeMatch: boolean;
  repechageEntrySize: number | null;
  repechageEntryRound: number;
  slots: BracketSlot[];
}

export const readBracket = async (api: Api, tournamentId: string): Promise<Bracket> =>
  api.json<Bracket>(await api.get(`tournaments/${tournamentId}/bracket`));

/**
 * registrationId → seed number, read from the `seed N` refs the generator wrote
 * onto rounds 0 and 1.
 *
 * Read from the bracket rather than assumed from the registration seeds we sent:
 * this reflects where each fighter ACTUALLY landed, and it is the only way to
 * get a complete map for a play-in bracket, where some fighters enter at round 0
 * and the rest at round 1. The generator guarantees each seed is placed exactly
 * once across those two rounds.
 */
export function seedMap(bracket: Bracket): Map<string, number> {
  const seeds = new Map<string, number>();
  const read = (ref: string | null): number | null => {
    const match = /^seed (\d+)$/.exec(ref ?? '');
    return match ? Number(match[1]) : null;
  };
  for (const slot of bracket.slots) {
    if (slot.round > 1) continue;
    const a = read(slot.source_a_ref);
    const b = read(slot.source_b_ref);
    if (a !== null && slot.redRegistrationId) seeds.set(slot.redRegistrationId, a);
    if (b !== null && slot.blueRegistrationId) seeds.set(slot.blueRegistrationId, b);
  }
  return seeds;
}

/** Absolute round of the grand final, or null in bronze mode (which has none). */
export function grandFinalRound(bracket: Bracket): number | null {
  if (bracket.secondChanceTarget === 'bronze') return null;
  return (bracket.wbRounds ?? 0) + (bracket.lbRounds ?? 0) + 1;
}

/** Absolute round of the conditional grand-final reset, or null when disabled. */
export function resetRound(bracket: Bracket): number | null {
  const gf = grandFinalRound(bracket);
  return gf !== null && bracket.grandFinalReset ? gf + 1 : null;
}

/**
 * True when the reset exists but was correctly NOT played — i.e. the grand final
 * was won by its side A, the unbeaten winners-bracket entrant. This is the one
 * slot allowed to finish a tournament unplayed, so the stall detector has to know
 * about it (`grandFinalEndsBracket` in `bracket-refs.ts`).
 */
function resetLegitimatelySkipped(bracket: Bracket): boolean {
  const gf = grandFinalRound(bracket);
  if (gf === null || !bracket.grandFinalReset) return false;
  const slot = bracket.slots.find((s) => s.round === gf);
  if (!slot || slot.status !== 'completed' || !slot.winnerRegistrationId) return false;
  return slot.winnerRegistrationId === slot.redRegistrationId;
}

/** Slots that can be played right now: both sides resolved, a match row, not done. */
const playableSlots = (bracket: Bracket): BracketSlot[] =>
  bracket.slots.filter(
    (s) =>
      s.matchId !== null &&
      s.redRegistrationId !== null &&
      s.blueRegistrationId !== null &&
      s.status !== 'completed' &&
      s.status !== 'voided',
  );

/** Slots that will never be played, and shouldn't be — only a skipped reset. */
const skippableSlots = (bracket: Bracket): BracketSlot[] => {
  const reset = resetRound(bracket);
  if (reset === null || !resetLegitimatelySkipped(bracket)) return [];
  return bracket.slots.filter((s) => s.round === reset);
};

/** Nothing left that could ever become playable — the bracket is finished. */
const isSettled = (bracket: Bracket): boolean => {
  const skipped = new Set(skippableSlots(bracket).map((s) => s.id));
  return bracket.slots.every((s) => s.status === 'completed' || skipped.has(s.id));
};

/**
 * Re-read until something is playable again, or the bracket is finished.
 *
 * `onMatchCompleted` is fire-and-forget (`void this.bracketAdvance…` in
 * `matches.service.ts`), so a downstream slot is filled some time AFTER the
 * status PATCH returns. Poll rather than assume. The finished-check short-cuts
 * the wait in the happy path; when something really is incomplete we spend the
 * whole budget, giving advancement every chance before calling it a stall.
 */
async function settle(api: Api, tournamentId: string, tries = 12, delayMs = 500): Promise<Bracket> {
  let bracket = await readBracket(api, tournamentId);
  for (let i = 0; i < tries; i++) {
    if (playableSlots(bracket).length > 0 || isSettled(bracket)) break;
    await sleep(delayMs);
    bracket = await readBracket(api, tournamentId);
  }
  return bracket;
}

/** Point values summing to `total`, as 2s then a 1 — the fewest requests. */
function hitValues(total: number): number[] {
  const values: number[] = [];
  let left = total;
  while (left >= 2) {
    values.push(2);
    left -= 2;
  }
  if (left === 1) values.push(1);
  return values;
}

/**
 * Play one match to completion the way the pad does: post clean exchanges until
 * `winnerColor` reaches the point cap, and let the ruleset engine complete the
 * match and set the winner.
 *
 * The loser scores FIRST and deliberately stops two points short. Two reasons:
 * the winner's final hit must be what trips `first_to_points`, and both sides
 * must never sit at the cap together — `pointCapWinnerColor` returns null in
 * that case, which would complete the match with NO winner, and a bracket slot
 * with no winner can never advance.
 *
 * Clean hits only, no doubles and no afterblows: the score arithmetic has to be
 * exact to land on the cap, and a double cap breach would end the match 0-0 with
 * a null winner. Afterblow netting is thoroughly unit-tested elsewhere; what is
 * being proved here is completion + advancement.
 */
export async function scoreMatch(
  api: Api,
  matchId: string,
  winnerColor: 'red' | 'blue',
  pointCap: number = POINT_CAP,
): Promise<void> {
  const loserColor = winnerColor === 'red' ? 'blue' : 'red';
  let sequence = 1;
  let clockMs = 4_000;

  const hit = async (color: 'red' | 'blue', value: number) => {
    await api.ok(
      await api.post(`matches/${matchId}/exchanges`, {
        data: {
          clientUuid: randomUUID(),
          sequence: sequence++,
          type: 'clean',
          occurredAt: new Date().toISOString(),
          clockTimeMs: clockMs,
          firstStrikerColor: color,
          firstStrikeValue: value,
        },
      }),
    );
    clockMs += 15_000;
  };

  for (const value of hitValues(Math.max(0, pointCap - 2))) await hit(loserColor, value);
  for (const value of hitValues(pointCap)) await hit(winnerColor, value);
}

export interface PlayResult {
  /** Matches actually completed by this driver. */
  played: number;
  /** Slots left unplayable that aren't a legitimately-skipped reset — i.e. bugs. */
  stalled: BracketSlot[];
  /** Human-readable stall report, empty string when `stalled` is empty. */
  stallReport: string;
  championRegistrationId: string | null;
  /** The bracket as it stands after play. */
  bracket: Bracket;
}

/**
 * Play a whole double-elimination bracket over the API.
 *
 * A FIXED-POINT loop, mirroring `double-elim-simulation.harness.ts`'s `playPass`
 * rather than iterating rounds in order. Round order is the wrong sequencer here:
 * a losers-bracket slot's readiness depends on a winners-bracket round it does
 * not follow numerically, and the reset slot does not exist at all until the
 * grand final has been decided. The loop's termination condition IS the stall
 * detector.
 *
 * The lower seed always wins, so the champion is seed 1 and every run is
 * reproducible — except at the grand final, which `forceLbWinsGrandFinal` flips
 * to force the reset to be played.
 */
export async function playDoubleElim(
  api: Api,
  tournamentId: string,
  opts: { forceLbWinsGrandFinal?: boolean } = {},
): Promise<PlayResult> {
  let bracket = await readBracket(api, tournamentId);
  const seeds = seedMap(bracket);
  const gf = grandFinalRound(bracket);
  let played = 0;

  const winnerOf = (slot: BracketSlot): string => {
    const red = slot.redRegistrationId as string;
    const blue = slot.blueRegistrationId as string;
    // Side A of the grand final is `winner of WBR{n}P1` — the unbeaten entrant.
    // Forcing side B to win is what makes the reset necessary.
    if (opts.forceLbWinsGrandFinal && gf !== null && slot.round === gf) return blue;
    const redSeed = seeds.get(red);
    const blueSeed = seeds.get(blue);
    if (redSeed === undefined || blueSeed === undefined) {
      throw new Error(
        `[double-elim] slot R${slot.round}P${slot.position} holds a registration with no seed ` +
          `(red=${redSeed ?? '?'}, blue=${blueSeed ?? '?'}) — the seed map read from rounds 0/1 is incomplete.`,
      );
    }
    return redSeed < blueSeed ? red : blue;
  };

  // Bounded so a bug can never spin forever: every pass plays >= 1 match.
  for (let pass = 0; pass < bracket.totalSlots + 5; pass++) {
    const ready = playableSlots(bracket);
    if (ready.length === 0) break;
    for (const slot of ready) {
      // Red is side A of the slot, so the intended winner's colour follows from
      // which registration it is. The ENGINE then derives the winner from the
      // score — this driver never declares one.
      const winnerColor = winnerOf(slot) === slot.redRegistrationId ? 'red' : 'blue';
      await scoreMatch(api, slot.matchId as string, winnerColor);
      played++;
    }
    bracket = await settle(api, tournamentId);
  }

  const skipped = new Set(skippableSlots(bracket).map((s) => s.id));
  const stalled = bracket.slots.filter((s) => s.status !== 'completed' && !skipped.has(s.id));

  return {
    played,
    stalled,
    stallReport: describeStalls(stalled),
    championRegistrationId: championOf(bracket),
    bracket,
  };
}

/**
 * The registration that won the title match: the reset if it was played, else the
 * grand final, else — in bronze mode, which has no grand final — the winners-
 * bracket final.
 */
export function championOf(bracket: Bracket): string | null {
  const winnerAt = (round: number): string | null => {
    const slot = bracket.slots.find((s) => s.round === round && s.position === 1);
    return slot?.status === 'completed' ? slot.winnerRegistrationId : null;
  };
  const reset = resetRound(bracket);
  if (reset !== null) {
    const fromReset = winnerAt(reset);
    if (fromReset) return fromReset;
  }
  const gf = grandFinalRound(bracket);
  if (gf !== null) return winnerAt(gf);
  return winnerAt(bracket.wbRounds ?? 0);
}

/**
 * Point the failure straight at the offending ref string. A stall is always a
 * slot waiting on a `winner of` / `loser of` that nothing will ever produce, so
 * the refs and which side is still null are the whole diagnosis.
 */
function describeStalls(stalled: BracketSlot[]): string {
  if (stalled.length === 0) return '';
  const lines = stalled.map((s) => {
    const missing = [
      s.redRegistrationId ? null : `A(${s.source_a_ref ?? 'no ref'})`,
      s.blueRegistrationId ? null : `B(${s.source_b_ref ?? 'no ref'})`,
    ].filter(Boolean);
    const why = missing.length > 0 ? `unresolved ${missing.join(' + ')}` : `status=${s.status}`;
    const match = s.matchId ? '' : ', no match row';
    return `  R${s.round}P${s.position}: ${why}${match}`;
  });
  return `${stalled.length} slot(s) never became playable:\n${lines.join('\n')}`;
}
