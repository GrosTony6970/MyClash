/**
 * One read of a bout from the server, and what it means for the bout screen.
 *
 * Combines `GET /matches/:id` (the raw row: registrations, scores, lock, round
 * state) and `GET /matches/:id/summary` (labels: round code, the two names,
 * the Tournament).
 *
 * GONE vs FAILED vs UNREACHABLE. A bad status used to mean one thing, "the
 * bout is deleted", and that is wrong the moment the tablet loses wifi: the
 * service worker RESOLVES a synthetic 503 for every /api/ call.
 * `classifySyncFailure` is the one owner of "is this no network". A request
 * that gets no answer at all (no service worker), and an answer that cannot be
 * read (a hall's sign-in page in place of the API), are the same verdict.
 * Only a 404 says the bout is gone. Any other answer (a 500, a 502 while the
 * API restarts, a 429) is the server failing, and says nothing about the bout.
 *
 * Pure but for the fetch it is given.
 */
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import type { MatchInfo } from '../components/MatchView';
import { classifySyncFailure, type FailureBody } from '../offline/failure-kind';

/**
 * The rules a bout scores with, from its own copy of its rules (ruling K, 2026-10-18: the bout
 * read carries them; `withBoutRules` on the server builds them). A bout keeps the rules it
 * started under, so these, not its Tournament's of now, are what the pad scores with. Display
 * (side colours, quick penalties) is the Tournament's, read from `/match-config`.
 */
export interface PadBoutRules {
  /**
   * The copy these rules are read from: a Start names it (`queuePress`). None on rules a tablet
   * kept before the server sent it.
   */
  id?: string;
  matchFormat: MatchFormatConfig;
  afterblowMode: TournamentScoringConfig['afterblowMode'];
  buttons: TournamentScoringConfig['buttons'];
  /** The card ruleset the copy pins; null is the built-in. */
  cardRulesetId: string | null;
}

export type BoutRead =
  /** `labelled` is false when the summary did not land: the bout has no names. */
  | { kind: 'bout'; match: MatchInfo; labelled: boolean }
  /** The server says there is no such bout. */
  | { kind: 'gone' }
  /** The server answered with a fault. Nothing is known about the bout. */
  | { kind: 'failed' }
  /** No network: nothing is known about the bout. */
  | { kind: 'unreachable' };

/** `GET /matches/:id` is a `select('*')`: the columns the pad reads. */
export interface BoutRow {
  id: string;
  match_number_label: string | null;
  status: string;
  red_registration_id: string;
  blue_registration_id: string;
  red_score: number | null;
  blue_score: number | null;
  winner_registration_id: string | null;
  locked_at: string | null;
  lice_id: string | null;
  end_reason: string | null;
  // Best-of-N round state (matches columns; default to a single round).
  current_round: number | null;
  red_round_wins: number | null;
  blue_round_wins: number | null;
  rounds_json: unknown;
  awaiting_round_advance: boolean | null;
  /** Not a column: the edition the server decides the bout with (`withBoutRules`). */
  decision_edition?: string;
  /** Not a column: the bout's own rules. Left out when the server could not build them. */
  rules?: PadBoutRules;
}

export interface BoutSummary {
  roundCode: string;
  redName: string;
  blueName: string;
  redClub?: string | null;
  blueClub?: string | null;
  weapon: string;
  tournamentId: string;
  tournamentName?: string | null;
  poolName?: string | null;
  roundToken?: string | null;
  liceName?: string | null;
  phaseType: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | null;
  /** Effective best-of for this match's phase (not a matches column). */
  bestOf?: number;
}

export async function readBout(
  apiUrl: string,
  matchId: string,
  fetchFn: typeof fetch = fetch,
): Promise<BoutRead> {
  try {
    const [rawRes, summaryRes] = await Promise.all([
      fetchFn(`${apiUrl}/api/v1/matches/${matchId}`, { credentials: 'include' }),
      fetchFn(`${apiUrl}/api/v1/matches/${matchId}/summary`, { credentials: 'include' }),
    ]);
    if (!rawRes.ok) {
      const body = (await rawRes.json().catch(() => null)) as FailureBody | null;
      if (classifySyncFailure(rawRes.status, body) === 'offline') return { kind: 'unreachable' };
      return { kind: rawRes.status === 404 ? 'gone' : 'failed' };
    }
    const raw = (await rawRes.json()) as BoutRow;
    // Soft requirement: the summary is labels only. It can fail alone (a fault
    // of one of its reads, a bout deleted between the two requests). The
    // scoreboard opens with blank labels rather than blocking the whole page on
    // a name lookup. A bracket slot with no fighters yet HAS a summary, with
    // blank names.
    const summary = summaryRes.ok ? ((await summaryRes.json()) as BoutSummary) : null;
    return { kind: 'bout', match: boutOf(raw, summary), labelled: summary !== null };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * The bout as the screen holds it. The ONE builder: the read of a whole piste
 * (`piste-read.ts`) gives the same row and the same summary per bout, so a copy
 * read ahead and a copy read by the bout screen have one shape.
 */
export function boutOf(raw: BoutRow, summary: BoutSummary | null): MatchInfo {
  return {
    id: raw.id,
    matchNumberLabel: raw.match_number_label ?? '',
    roundCode: summary?.roundCode ?? '',
    status: raw.status,
    redRegistrationId: raw.red_registration_id,
    blueRegistrationId: raw.blue_registration_id,
    redScore: raw.red_score ?? 0,
    blueScore: raw.blue_score ?? 0,
    // GET /matches/:id is a select('*'), so this has always been on the wire:
    // the client simply dropped it, and the end-of-match overlay announced
    // whoever had more points.
    winnerRegistrationId: raw.winner_registration_id ?? null,
    redFighterName: summary?.redName ?? '',
    blueFighterName: summary?.blueName ?? '',
    redClub: summary?.redClub ?? null,
    blueClub: summary?.blueClub ?? null,
    weapon: summary?.weapon ?? '',
    tournamentId: summary?.tournamentId,
    tournamentName: summary?.tournamentName ?? null,
    poolName: summary?.poolName ?? null,
    roundToken: summary?.roundToken ?? null,
    liceName: summary?.liceName ?? null,
    phaseType: summary?.phaseType ?? null,
    lockedAt: raw.locked_at,
    liceId: raw.lice_id,
    endReason: raw.end_reason ?? null,
    // bestOf is the effective number from the summary; the live round counters
    // come off the raw matches row.
    bestOf: summary?.bestOf ?? 1,
    currentRound: raw.current_round ?? 1,
    redRoundWins: raw.red_round_wins ?? 0,
    blueRoundWins: raw.blue_round_wins ?? 0,
    roundsJson: raw.rounds_json ?? null,
    awaitingRoundAdvance: raw.awaiting_round_advance ?? false,
    decisionEdition: raw.decision_edition,
    rules: raw.rules,
  };
}

/**
 * The bout of a new answer, keeping the rules already held for it when the answer carries none.
 * A started bout's copy never changes, and a scheduled bout's new copy arrives WITH its rules, so
 * an answer without them is a passing server fault: it must not switch a running bout's +3
 * buttons to its Tournament's +2. The rule `labelled` follows for the names, here for the rules;
 * the screen's bout and the kept copy both go through it.
 *
 * `startedUnder`: the copy a Start of this bout names that the server has not taken and may keep
 * (`unsentStarts`, asked BEFORE the read). An answer that still says `scheduled` is then behind
 * the tablet: a change of the rules moved the bout on the server, and its Start, when it lands,
 * puts it back on that copy (`startCopyOf`). Until that answer the bout keeps the rules it started
 * under, with the edition they go with, so the pad decides an End, a round and the winner at the
 * cap as the server will; only when they ARE that copy.
 */
export function withHeldRules(
  next: MatchInfo,
  held: MatchInfo | null | undefined,
  startedUnder: string | undefined,
): MatchInfo {
  if (!held?.rules || held.id !== next.id) return next;
  if (startedUnder !== undefined && startedUnder === held.rules.id && next.status === 'scheduled') {
    const { rules, decisionEdition } = held;
    return { ...next, rules, decisionEdition };
  }
  return next.rules ? next : { ...next, rules: held.rules };
}

/** The bout on the screen, where it came from, and whether its rules changed under it. */
export interface ShownBout {
  match: MatchInfo;
  /** When the tablet read its copy (ms); null for the server's own answer. */
  readAt: number | null;
  /** The server's answer brought rules of another copy than the screen showed (sticky). */
  rulesChanged: boolean;
}

/**
 * The bout the screen shows after a server answer. `now` is what it shows (a copy, the server's
 * last answer, another bout, or nothing); `kept` is the tablet's copy, the held bout when the
 * screen shows none of this bout and a Start waits (a fresh open races its own Start).
 *
 * The notice "the organiser changed the rules" lives here, not in the screen: the screen is
 * mounted again when the server's bout replaces the tablet's copy, and a remembered id would go
 * with it. Raised when the rules shown and the rules kept are of two copies, both named; it stays
 * for that bout, and a bout of another id starts without it.
 */
export function nextShown(
  now: ShownBout | null,
  answer: MatchInfo,
  startedUnder: string | undefined,
  kept: MatchInfo | null = null,
): ShownBout {
  const same = now?.match.id === answer.id;
  const held = same ? now!.match : kept;
  const match = withHeldRules(answer, held, startedUnder);
  const before = held?.rules?.id;
  const after = match.rules?.id;
  const changed = before !== undefined && after !== undefined && before !== after;
  return { match, readAt: null, rulesChanged: (same && now!.rulesChanged) || changed };
}
