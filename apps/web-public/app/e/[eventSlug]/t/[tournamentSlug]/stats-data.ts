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

import type { AfterblowRule, BlowValueCounts } from '@myclash/ui';

// ── API types ─────────────────────────────────────────────────────────────────

/** GET /tournaments/:id/stats/fighters */
export interface FighterStatsPayload {
  fighters: FighterStats[];
  afterblow: AfterblowRule;
}

/**
 * No ruleset resolved, so the table claims no worth for an afterblow rather
 * than heading the column with a number nobody declared.
 */
const EMPTY_AFTERBLOW: AfterblowRule = { valuation: null, fixedValue: null };

export interface FighterStats {
  registrationId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  doubles: number;
  /**
   * Blow counts keyed by the point value that occurred, ascending. Twelve fixed
   * fields before (`hitsGiven1`..`afterblowReceived3`), so a target worth 4 or
   * more had nowhere to appear. See migration 0189.
   */
  byValue: BlowValueCounts[];
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
  /** The ruleset's afterblow valuation, for the blow table column headings. */
  afterblow: AfterblowRule;
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
    // The fighters endpoint returns { fighters, afterblow }: the counts, and how
    // this tournament's ruleset values an afterblow so the columns can be headed
    // truthfully rather than asserting FFAMHE's flat 1.
    const fighterPayload = fightersRes.ok
      ? ((await fightersRes.json()) as FighterStatsPayload)
      : null;
    const targets = targetsRes.ok ? ((await targetsRes.json()) as TargetValueStats) : EMPTY_TARGETS;

    return {
      overview,
      fighters: fighterPayload?.fighters ?? [],
      afterblow: fighterPayload?.afterblow ?? EMPTY_AFTERBLOW,
      targets,
    };
  } catch {
    return {
      overview: null,
      fighters: [],
      afterblow: EMPTY_AFTERBLOW,
      targets: EMPTY_TARGETS,
    };
  }
}
