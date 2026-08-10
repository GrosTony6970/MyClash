'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { GearResult } from './useGear';

export interface MatchGearSide {
  /** Null when this fighter has never been checked for this bout's weapon. */
  result: GearResult | null;
  reason: string | null;
  checkedAt: string | null;
}

export interface MatchGear {
  weaponName: string | null;
  red: MatchGearSide;
  blue: MatchGearSide;
}

/**
 * The two fighters' gear standing, for the pad header.
 *
 * BEST EFFORT, and that is the whole design. Offline scoring is
 * non-negotiable, so this must never be something the pad waits on: there is
 * no loading state, no error state and no retry — a failed or offline fetch
 * leaves the value null and the header renders exactly as it did before the
 * chip existed. A referee on a dead network scores the bout; they simply do
 * not get the gear line.
 *
 * Fetched once per match rather than polled. A re-check at the gear table
 * during the bout is not something the referee acts on mid-exchange, and a
 * poll would put a recurring network call on the one surface that must stay
 * usable without a network.
 */
export function useMatchGear(matchId: string): MatchGear | null {
  // The answer is stored WITH the match it answers for, and staleness is
  // derived in render rather than cleared by a setState in the effect. On the
  // pad that matters twice over: it satisfies react-hooks/set-state-in-effect,
  // and it means the previous bout's gear line can never flash onto the next
  // one while its fetch is in flight.
  const [state, setState] = useState<{ matchId: string; gear: MatchGear } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<MatchGear>(`/api/v1/staff/gear/match/${matchId}`)
      .then((next) => {
        if (!cancelled) setState({ matchId, gear: next });
      })
      .catch(() => {
        // Swallowed on purpose — see the note above. A gear chip is never a
        // reason to show the referee an error.
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  return state?.matchId === matchId ? state.gear : null;
}
