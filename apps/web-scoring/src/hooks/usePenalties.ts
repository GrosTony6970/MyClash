'use client';

import { useCallback, useEffect, useState } from 'react';

export type PenaltyCard = 'yellow' | 'red' | 'black';

export interface PenaltyRulesetEntry {
  id: string;
  group_number: number;
  ref_number: number;
  short_name: string;
  description: string;
  /** Card colours this entry triggers (subset of the ruleset's card set). */
  sanctions: PenaltyCard[];
}

export interface PenaltyRuleset {
  id: string;
  name: string;
  penalty_ruleset_entries?: PenaltyRulesetEntry[];
}

export interface MatchPenalty {
  id: string;
  sequence: number;
  registration_id: string;
  card: PenaltyCard;
  source: 'ruleset' | 'direct';
  short_name: string | null;
  reason: string | null;
  score_delta: number;
  causes_match_forfeit: boolean;
  voided: boolean;
  /** ISO timestamp the penalty was applied. */
  occurred_at?: string;
}

interface UsePenaltiesResult {
  ruleset: PenaltyRuleset | null;
  penalties: MatchPenalty[];
  /** Non-voided penalties only — what the operator typically wants. */
  active: MatchPenalty[];
  /** Set of card colours the ruleset uses (derived from entry sanctions). */
  ruleSetCards: PenaltyCard[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /**
   * Filter helper: count of active penalties for a registration matching
   * the given card colour. Used by the per-side card counter chips.
   */
  countFor: (registrationId: string, card: PenaltyCard) => number;
}

const ALL_CARDS: PenaltyCard[] = ['yellow', 'red', 'black'];

/**
 * Centralised penalty + ruleset fetch. Used by:
 *   - the per-side penalty picker (ruleset entries)
 *   - the per-side card-counter chips under the club name
 *   - the centre column's unified events list (rendered alongside
 *     exchanges)
 *
 * Two fetches resolved in parallel: `/penalty-ruleset` and
 * `/penalties`. Re-runs when `refreshKey` is bumped (after each
 * applied or voided penalty).
 */
export function usePenalties(
  apiUrl: string,
  matchId: string | null | undefined,
  refreshKey: number,
): UsePenaltiesResult {
  const [ruleset, setRuleset] = useState<PenaltyRuleset | null>(null);
  const [penalties, setPenalties] = useState<MatchPenalty[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!matchId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${apiUrl}/api/v1/matches/${matchId}/penalty-ruleset`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([rulesetRes, penaltiesRes]) => {
        if (rulesetRes.ok) {
          setRuleset((await rulesetRes.json()) as PenaltyRuleset | null);
        }
        if (penaltiesRes.ok) {
          setPenalties((await penaltiesRes.json()) as MatchPenalty[]);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, matchId]);

  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh, refreshKey]);

  const active = penalties.filter((p) => !p.voided);

  // Derive the set of card colours actually used by this ruleset's
  // entries. Falls back to the full {yellow, red, black} set if the
  // ruleset doesn't enumerate any entries with sanctions.
  const ruleSetCards = (() => {
    const seen = new Set<PenaltyCard>();
    for (const entry of ruleset?.penalty_ruleset_entries ?? []) {
      for (const card of entry.sanctions) seen.add(card);
    }
    if (seen.size === 0) return ALL_CARDS;
    return ALL_CARDS.filter((c) => seen.has(c));
  })();

  const countFor = (registrationId: string, card: PenaltyCard) =>
    active.filter((p) => p.registration_id === registrationId && p.card === card).length;

  return { ruleset, penalties, active, ruleSetCards, loading, error, refresh, countFor };
}
