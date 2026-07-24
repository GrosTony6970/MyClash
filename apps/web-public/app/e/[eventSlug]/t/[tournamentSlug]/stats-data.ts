/**
 * Shared tournament-stats data layer.
 *
 * Types + a single `fetchTournamentStats` helper used by BOTH the inline
 * Statistics tab (client, `StatsTab`, load-on-demand via `getPublicApiUrl()`)
 * and the standalone `/stats` route (server, via `getServerApiUrl()`).
 *
 * The helper is keyed by tournament **id** and the caller passes the API base
 * URL, so it stays context-agnostic — no `getServerApiUrl`/`getPublicApiUrl`
 * import here (which would tie it to one execution context and trip the
 * `no-server-api-url-leak` lint if pulled into a client file).
 */

// ── API types ─────────────────────────────────────────────────────────────────

export interface FighterStats {
  registrationId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  doubles: number;
  hitsGiven1: number;
  afterblowGiven1: number;
  hitsGiven2: number;
  afterblowGiven2: number;
  hitsGiven3: number;
  afterblowGiven3: number;
  hitsReceived1: number;
  afterblowReceived1: number;
  hitsReceived2: number;
  afterblowReceived2: number;
  hitsReceived3: number;
  afterblowReceived3: number;
  blowsGiven: number;
  blowsReceived: number;
  afterblowsReceivedTotal: number;
  pointsGiven: number;
  pointsReceived: number;
  totalExchanges: number;
  hitRatio: number | null;
  pointRatio: number | null;
}

export interface Overview {
  tournamentId: string;
  participantCount: number;
  matchCount: number;
  exchangeCount: number;
  doublesCount: number;
  doublesPercent: number;
  clubCount: number;
  topFighters: Array<{
    name: string;
    club: string | null;
    hitRatio: number | null;
    blowsGiven: number;
    blowsReceived: number;
  }>;
}

export interface TargetValueStats {
  maxValue: number | null;
  distribution: Array<{ value: number; cleanHits: number }>;
  hunters: Array<{ personId: string; name: string; club: string | null; cleanHits: number }>;
}

export const EMPTY_TARGETS: TargetValueStats = { maxValue: null, distribution: [], hunters: [] };

export interface TournamentStats {
  overview: Overview | null;
  fighters: FighterStats[];
  targets: TargetValueStats;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the three public stats projections for a tournament in parallel.
 *
 * `apiBase` is supplied by the caller: `getServerApiUrl()` on the server
 * (`/stats` route) or `getPublicApiUrl()` in the browser (`StatsTab`). Failures
 * degrade gracefully — a missing overview is `null`, missing lists are empty —
 * so the presentational layer can render its own empty state.
 */
export async function fetchTournamentStats(
  tournamentId: string,
  apiBase: string,
): Promise<TournamentStats> {
  try {
    const [overviewRes, fightersRes, targetsRes] = await Promise.all([
      fetch(`${apiBase}/api/v1/tournaments/${tournamentId}/stats/overview`, {
        cache: 'no-store',
      }),
      fetch(`${apiBase}/api/v1/tournaments/${tournamentId}/stats/fighters`, {
        cache: 'no-store',
      }),
      fetch(`${apiBase}/api/v1/tournaments/${tournamentId}/stats/target-values`, {
        cache: 'no-store',
      }),
    ]);

    const overview = overviewRes.ok ? ((await overviewRes.json()) as Overview) : null;
    const fighters = fightersRes.ok ? ((await fightersRes.json()) as FighterStats[]) : [];
    const targets = targetsRes.ok ? ((await targetsRes.json()) as TargetValueStats) : EMPTY_TARGETS;

    return { overview, fighters, targets };
  } catch {
    return { overview: null, fighters: [], targets: EMPTY_TARGETS };
  }
}
