'use client';

import { useEffect, useState } from 'react';
import { apiRequest, failureMessage, type ApiResult } from '@myclash/api-client';
import type { TournamentScoringConfig } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';
import type { ApiBracketSlot, ApiPoolWithMatches } from './build-print-data';

export interface TournamentDetail {
  name: string;
  ruleset_code?: string | null;
  ruleset_version?: string | null;
  scoring_config_json?: TournamentScoringConfig | null;
}

/** What one Tournament's pack is drawn from. */
export interface TournamentPack {
  detail: TournamentDetail;
  pools: ApiPoolWithMatches[];
  bracket: { rounds: number; slots: ApiBracketSlot[] } | null;
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

const apiUrl = getPublicApiUrl();

async function readPack(
  tournamentId: string,
  signal: AbortSignal,
): Promise<ApiResult<TournamentPack>> {
  const options = { signal };
  const [detail, pools, bracket] = await Promise.all([
    apiRequest<TournamentDetail>(apiUrl, `/api/v1/tournaments/${tournamentId}`, options),
    apiRequest<ApiPoolWithMatches[]>(
      apiUrl,
      `/api/v1/tournaments/${tournamentId}/pools-with-matches`,
      options,
    ),
    // A tournament with no bracket phase 404s here; that is a valid state
    // (pools only), not an error worth blocking the whole page for.
    apiRequest<{ rounds: number; slots: ApiBracketSlot[] }>(
      apiUrl,
      `/api/v1/tournaments/${tournamentId}/bracket`,
      options,
    ),
  ]);
  if (!detail.ok) return detail;
  return {
    ok: true,
    data: {
      detail: detail.data,
      pools: pools.ok ? (pools.data ?? []) : [],
      bracket: bracket.ok ? bracket.data : null,
    },
  };
}

/**
 * The packs of the Tournaments asked for, in their order: one, or every Tournament of the
 * Event for "All Tournaments" (O22). All or nothing: a pack refused leaves no pack, and the
 * reason, so a joined print job never lacks a Tournament in silence.
 *
 * `loading` is DERIVED from which ids the packs belong to, never set in an effect body:
 * the packs on screen are stale the moment the ids change.
 */
export function usePrintPackData(tournamentIds: readonly string[], t: Translator) {
  const asked = tournamentIds.join(',');
  const [packs, setPacks] = useState<TournamentPack[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!asked) return;
    const controller = new AbortController();
    void Promise.all(asked.split(',').map((id) => readPack(id, controller.signal)))
      .then((answers) => {
        const refused = answers.find((answer) => !answer.ok);
        if (refused && !refused.ok) {
          // The detail read had no `.ok` check at all once, so a refusal was cast to a
          // TournamentDetail and printed.
          setPacks([]);
          const message = failureMessage(refused, t, t('organizer.printPack.loadError'));
          if (message) setError(message);
          return;
        }
        setPacks(answers.flatMap((answer) => (answer.ok ? [answer.data] : [])));
        setError(null);
      })
      // Settled either way: an error must stop the spinner, or the operator stares at
      // "loading" with the reason already on screen underneath it.
      .finally(() => setLoadedFor(asked));
    return () => controller.abort();
  }, [asked, t]);

  const current = loadedFor === asked;
  return { packs: current ? packs : [], loading: asked !== '' && !current, error };
}
