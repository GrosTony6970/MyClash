/**
 * The one read of a bout's penalty catalogue: which entries exist, and the card
 * each one carries.
 *
 * The route is by bout (`GET /matches/:id/penalty-ruleset`: the one a staff
 * session may read), and the answer is the same for every bout of a Tournament:
 * the catalogue is the Tournament's, then the Event's, then the built-in one.
 * So it is kept on the tablet BY TOURNAMENT. It was kept by bout, and a bout the
 * tablet had never opened then had no catalogue with no network, though the
 * bout before it had the same one: an empty penalty picker.
 *
 * A bout read without its summary has no Tournament id. Its catalogue is kept
 * by the bout's own path, as it was.
 */
import { fetchWithCache } from '../offline/cached-reads';

/** Where the catalogue of a Tournament is kept in the tablet's `reads` table. */
export const catalogueKey = (tournamentId: string) => `penalty-ruleset/tournament/${tournamentId}`;

export function readPenaltyCatalogue<T>(
  apiUrl: string,
  matchId: string,
  tournamentId: string | null | undefined,
  signal?: AbortSignal,
): Promise<{ body: T; fetchedAt: number; fresh: boolean } | null> {
  const path = `/api/v1/matches/${matchId}/penalty-ruleset`;
  return fetchWithCache<T>(
    apiUrl,
    path,
    { credentials: 'include', signal },
    tournamentId ? catalogueKey(tournamentId) : path,
  );
}
