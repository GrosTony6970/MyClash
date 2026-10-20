'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@myclash/api-client';
import type { ForfeitAsks } from '@myclash/types/forfeit-rules';

/**
 * Which forfeit reasons ask "can the Fighter continue?" in the bout's Tournament (ruling 76), as
 * its `/match-config` answers them. `undefined` while read (or with no Tournament known yet);
 * `null` when the server holds no answer of the rules, or the read failed: the form then asks.
 */
export function useForfeitAsks(
  apiUrl: string,
  tournamentId: string | null | undefined,
): ForfeitAsks | null | undefined {
  const [read, setRead] = useState<{ tournamentId: string; asks: ForfeitAsks | null } | null>(null);
  useEffect(() => {
    if (!tournamentId) return;
    const controller = new AbortController();
    void apiRequest<{ forfeitAsks?: ForfeitAsks | null }>(
      apiUrl,
      `/api/v1/tournaments/${tournamentId}/match-config`,
      { signal: controller.signal },
    ).then((result) => {
      if (controller.signal.aborted) return;
      setRead({ tournamentId, asks: result.ok ? (result.data.forfeitAsks ?? null) : null });
    });
    return () => controller.abort();
  }, [apiUrl, tournamentId]);
  // An answer read for another Tournament is not this one's.
  return read && read.tournamentId === tournamentId ? read.asks : undefined;
}
