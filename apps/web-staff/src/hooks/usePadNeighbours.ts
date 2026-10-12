'use client';

import { useEffect, useState } from 'react';
import { useAdjacentMatches } from '@myclash/ui';
import { keptNeighbours, type KeptNeighbours } from '../offline/kept-piste';

/** What the tablet holds, and the bout it is the neighbours of. */
interface FromTablet extends KeptNeighbours {
  matchId: string;
}

/**
 * Whose neighbours the tiles show.
 *
 * The server's, once it has answered for this bout: at this read or at an
 * earlier one (a read that fails keeps them, `neighboursOf`). "No neighbour"
 * is an answer too: the last bout of a piste has no Next. Until then, the
 * tablet's own, from the piste it keeps, and never another bout's.
 */
export function neighboursOnPad(
  server: KeptNeighbours & { answered: boolean },
  tablet: FromTablet | null,
  matchId: string,
): KeptNeighbours {
  if (server.answered) return { previous: server.previous, next: server.next };
  if (tablet?.matchId !== matchId) return { previous: null, next: null };
  return { previous: tablet.previous, next: tablet.next };
}

/**
 * The bouts before and after the one on screen: the tiles of the header and
 * the "Next match" of the result screen.
 *
 * The server says them (`useAdjacentMatches`). With no network it cannot, and
 * a bout opened from the tablet's copy then had no way on: the table stopped
 * after one bout. The tablet keeps the order of its piste (`kept-piste.ts`),
 * so it names the neighbours itself until the server does (quick-win ruling 4).
 *
 * The race: the tablet's store answers late, and may answer after the screen
 * moved to another bout. What it gave is held with its bout, and shown for
 * that bout only.
 */
export function usePadNeighbours(
  apiUrl: string,
  match: { id: string; liceId?: string | null },
  refreshKey: number,
): KeptNeighbours {
  const server = useAdjacentMatches(apiUrl, match.id, refreshKey);
  const [tablet, setTablet] = useState<FromTablet | null>(null);
  const { id: matchId, liceId } = match;

  useEffect(() => {
    if (!liceId) return;
    let cancelled = false;
    void keptNeighbours(liceId, matchId)
      .then((kept) => {
        if (!cancelled && kept) setTablet({ matchId, ...kept });
      })
      // A store that cannot be read costs the tiles with no network only.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [liceId, matchId, refreshKey]);

  return neighboursOnPad(server, tablet, matchId);
}
