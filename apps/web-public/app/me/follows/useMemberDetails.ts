'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FighterMedal, FighterPlacement, WeaponStat } from '@/lib/weapon-stats';

/** Fighter profile slice used by the stats panel (weapons, HEMA, imported medals). */
export interface MemberFighter {
  weapons: Array<{
    favorite?: boolean;
    weapon_catalog?: { id?: string | null; slug?: string | null; name?: string | null } | null;
  }>;
  hemaRatingsId: string | null;
  hemaRatings: {
    detailsUrl?: string;
    ratings: Array<{ weapon: string; rank: number | null; weightedRating: number }>;
  } | null;
  medals: FighterMedal[];
}

export interface MemberCareer {
  stats: { overall: WeaponStat; byWeapon: Array<WeaponStat & { weapon: string }> };
  tournamentPlacements: FighterPlacement[];
}

export interface MemberReferee {
  totalMatches: number;
  averageRefereeTimeMs: number;
  eventsWorked: number;
  cards: { yellow: number; red: number; black: number };
}

export interface MemberDetails {
  fighter: MemberFighter | null;
  career: MemberCareer | null;
  refereeStats: MemberReferee | null;
}

/** Raw `/fighters/:slug` shape — the DB row (snake_case) merged with the
 *  camelCase hemaRatings object + weapons/medals relations. */
interface RawFighter {
  weapons?: MemberFighter['weapons'];
  hemaRatingsId?: string | null;
  hema_ratings_id?: string | null;
  hemaRatings?: MemberFighter['hemaRatings'];
  medals?: FighterMedal[];
}

// Per-slug cache persists across mount/unmount within the SPA session so
// re-expanding a card (or expanding another group holding the same person)
// never refetches. Only successful loads are cached, so errors can retry.
const cache = new Map<string, MemberDetails>();

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Network error or abort — degrade this slice to null; the caller guards
    // against acting on an aborted request via signal.aborted.
    return null;
  }
}

/**
 * Lazily loads the three public per-slug endpoints that feed the stats panel,
 * once `enabled` (card expanded or warmed on hover). Successful results live in
 * a module cache; `details`/`loading` are derived from it so the effect only
 * writes state after the async fetch settles. Each slice degrades to null
 * independently, so a missing referee / HEMA record doesn't fail the card.
 */
export function useMemberDetails(apiUrl: string, slug: string, enabled: boolean) {
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  const details = cache.get(slug) ?? null;
  const loading = enabled && !details && !error;

  useEffect(() => {
    if (!enabled || cache.has(slug)) return;
    const controller = new AbortController();

    void (async () => {
      const [fighterRaw, career, referee] = await Promise.all([
        fetchJson<RawFighter>(`${apiUrl}/api/v1/fighters/${slug}`, controller.signal),
        fetchJson<MemberCareer>(`${apiUrl}/api/v1/fighters/${slug}/career`, controller.signal),
        fetchJson<MemberReferee>(
          `${apiUrl}/api/v1/fighters/${slug}/referee-stats`,
          controller.signal,
        ),
      ]);
      if (controller.signal.aborted) return;

      const fighter: MemberFighter | null = fighterRaw
        ? {
            weapons: fighterRaw.weapons ?? [],
            hemaRatingsId: fighterRaw.hemaRatingsId ?? fighterRaw.hema_ratings_id ?? null,
            hemaRatings: fighterRaw.hemaRatings ?? null,
            medals: fighterRaw.medals ?? [],
          }
        : null;

      if (fighter || career || referee) {
        cache.set(slug, { fighter, career, refereeStats: referee });
        setNonce((n) => n + 1); // re-render to read the freshly cached details
      } else {
        setError(true);
      }
    })();

    return () => controller.abort();
  }, [apiUrl, slug, enabled, nonce]);

  const reload = useCallback(() => {
    cache.delete(slug);
    setError(false);
    setNonce((n) => n + 1);
  }, [slug]);

  return { loading, error, details, reload };
}
