'use client';

/**
 * The Swiss route's single read.
 *
 * `GET /tournaments/:id/swiss-admin` answers for a tournament with no Swiss
 * phase too — that is the state the Configure tab exists to leave, and it still
 * needs the field size to propose a round count. So every tab reads this one
 * hook and branches on `phaseId === null` rather than each fetching its own
 * slice of the truth.
 */

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage, type ApiFailure } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

export interface SwissGrouping {
  kind: 'points' | 'scoreBands';
  boundaries?: number[];
}

export interface SwissPoints {
  win: number;
  draw: number;
  loss: number;
  bye: number;
}

export interface SwissConfig {
  roundCount: number;
  seedingStrategy: 'random' | 'by-rating' | 'by-pool-rank';
  seedingRandomSeed?: number | null;
  sourcePhaseId?: string | null;
  pairingMethod: 'fold' | 'adjacent';
  grouping: SwissGrouping;
  rankBy: 'swissPts' | 'rulesetScore';
  points: SwissPoints;
  tiebreakChain: string[];
  minRatingCoveragePercent?: number | null;
  finalized?: { atRound: number; at: string; byUserId: string } | null;
}

export interface SwissEntrant {
  registrationId: string;
  personName: string;
  clubLabel: string | null;
  withdrawnAtRound: number | null;
}

export interface SwissRoundValidity {
  valid: boolean;
  duplicated: string[];
  missing: string[];
  unknown: string[];
}

export interface SwissWarning {
  code: 'forced-rematch' | 'no-perfect-matching' | 'singleton-band';
  registrationIds: string[];
}

export interface SwissAdminMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  liceName: string | null;
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  redScore: number | null;
  blueScore: number | null;
}

export interface SwissAdminRound {
  id: string;
  roundNumber: number;
  status: string;
  byeRegistrationId: string | null;
  warnings: SwissWarning[];
  manualAdjustments: unknown[];
  validity: SwissRoundValidity;
  matches: SwissAdminMatch[];
}

/** How many of the field HEMA Ratings actually has a rating for. */
export interface RatingCoverage {
  rated: number;
  total: number;
  percent: number;
}

export interface SwissAdminView {
  phaseId: string | null;
  config: SwissConfig | null;
  registeredCount: number;
  /** Null when the ratings lookup failed; `percent: 0` when nobody is rated. */
  ratingCoverage: RatingCoverage | null;
  recommendedRoundCount: number;
  entrants: SwissEntrant[];
  rounds: SwissAdminRound[];
}

export interface UseSwissAdmin {
  view: SwissAdminView | null;
  loading: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  reload: () => Promise<void>;
  /** registrationId → display name, for pairing rows and swap pickers. */
  nameOf: (registrationId: string | null) => string;
}

export function useSwissAdmin(tournamentId: string, loadFailed: string): UseSwissAdmin {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const [view, setView] = useState<SwissAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!tournamentId) return;
      setLoading(true);
      const r = await apiRequest<SwissAdminView>(
        apiUrl,
        `/api/v1/tournaments/${tournamentId}/swiss-admin`,
        signal ? { signal } : {},
      );
      // The board unmounted, or moved to another tournament. Nothing to say,
      // and nothing to stop spinning for either — a newer load owns that now.
      if (!r.ok && r.kind === 'aborted') return;
      setLoading(false);
      if (!r.ok) {
        // Was one fixed sentence for every refusal alike. A Swiss phase is
        // refused by name — no entrants, a round already scored — and that is
        // the half an organiser can act on.
        setError(failureMessage(r, t, loadFailed));
        return;
      }
      setView(r.data);
      setError(null);
    },
    [apiUrl, tournamentId, loadFailed, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch lifecycle: load sets state only after the awaited request resolves
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const nameOf = useCallback(
    (registrationId: string | null) => {
      if (!registrationId) return '';
      const entrant = view?.entrants.find((e) => e.registrationId === registrationId);
      // Never the raw id: an operator reading a UUID on a pairing card learns
      // nothing, and the fallback is what makes a missing name obvious.
      return entrant?.personName || '—';
    },
    [view],
  );

  return { view, loading, error, setError, reload: load, nameOf };
}

/** One override warning, as `swiss-override.service.ts` raises it. */
export interface SwissOverrideWarning {
  code: 'creates-rematch' | 'repeat-bye' | 'same-club';
  registrationIds: string[];
}

export type SwissMutateResult =
  | { ok: true; data: unknown }
  | { ok: false; failure: ApiFailure; warnings: SwissOverrideWarning[] };

/**
 * POST/PATCH/DELETE against the Swiss API, surfacing the server's own message
 * AND the structured warnings behind a 409.
 *
 * The warnings are read from `details`, not from the top level: every error goes
 * through the RFC 9457 envelope in `api-exception.filter.ts`, which lifts the
 * standard members out and moves anything else — here `warnings` — under
 * `details`. Reading `body.warnings` gets `undefined` and the operator is asked
 * to confirm something the dialog cannot name.
 *
 * The read of that bag is the seam's now — `ApiFailure.details` — and so is the
 * reason, which used to be `body.message` or the invented line "HTTP 409".
 */
export async function swissMutate(
  path: string,
  init: { method: string; body?: unknown },
): Promise<SwissMutateResult> {
  const r = await apiRequest<unknown>(getPublicApiUrl(), `/api/v1${path}`, {
    method: init.method,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  if (r.ok) return { ok: true, data: r.data ?? null };
  const warnings = r.kind === 'http' ? r.details?.['warnings'] : undefined;
  return {
    ok: false,
    failure: r,
    warnings: Array.isArray(warnings) ? (warnings as SwissOverrideWarning[]) : [],
  };
}
