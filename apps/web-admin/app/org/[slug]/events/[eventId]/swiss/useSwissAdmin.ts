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

export interface SwissAdminView {
  phaseId: string | null;
  config: SwissConfig | null;
  registeredCount: number;
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
  const [view, setView] = useState<SwissAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!tournamentId) return;
      setLoading(true);
      try {
        const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/swiss-admin`, {
          credentials: 'include',
          signal,
        });
        if (!res.ok) throw new Error(loadFailed);
        setView((await res.json()) as SwissAdminView);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : loadFailed);
      } finally {
        setLoading(false);
      }
    },
    [apiUrl, tournamentId, loadFailed],
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
  | { ok: false; status: number; message: string; warnings: SwissOverrideWarning[] };

/**
 * POST/PATCH/DELETE against the Swiss API, surfacing the server's own message
 * AND the structured warnings behind a 409.
 *
 * The warnings are read from `details`, not from the top level: every error goes
 * through the RFC 9457 envelope in `api-exception.filter.ts`, which lifts the
 * standard members out and moves anything else — here `warnings` — under
 * `details`. Reading `body.warnings` gets `undefined` and the operator is asked
 * to confirm something the dialog cannot name.
 */
export async function swissMutate(
  path: string,
  init: { method: string; body?: unknown },
): Promise<SwissMutateResult> {
  const res = await fetch(`${getPublicApiUrl()}/api/v1${path}`, {
    method: init.method,
    credentials: 'include',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.ok) return { ok: true, data: await res.json().catch(() => null) };
  const body = (await res.json().catch(() => null)) as {
    message?: string | string[];
    details?: { warnings?: SwissOverrideWarning[] };
  } | null;
  const message = Array.isArray(body?.message)
    ? body.message.join(', ')
    : (body?.message ?? `HTTP ${res.status}`);
  return {
    ok: false,
    status: res.status,
    message,
    warnings: body?.details?.warnings ?? [],
  };
}
