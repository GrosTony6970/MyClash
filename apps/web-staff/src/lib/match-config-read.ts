/**
 * The one read of a Tournament's scoring rules for the pad: the buttons, the
 * cap, the rounds. Kept on the tablet by its path, which is per Tournament
 * (`offline/cached-reads.ts` says why a default must never stand in for it).
 *
 * Two callers: the bout screen, and the read that keeps a whole piste
 * (`keep-piste.ts`), so a bout of a Tournament the tablet never scored has its
 * rules with no network.
 */
import { fetchWithCache } from '../offline/cached-reads';

export function readMatchConfig<T>(
  apiUrl: string,
  tournamentId: string,
  signal?: AbortSignal,
): Promise<{ body: T; fetchedAt: number; fresh: boolean } | null> {
  return fetchWithCache<T>(apiUrl, `/api/v1/tournaments/${tournamentId}/match-config`, { signal });
}
