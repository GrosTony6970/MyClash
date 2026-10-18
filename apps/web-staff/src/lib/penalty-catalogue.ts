/**
 * The one read of a bout's penalty catalogue: which entries exist, and the card
 * each one carries.
 *
 * The route is by bout (`GET /matches/:id/penalty-ruleset`: the one a staff
 * session may read), and it answers the card rules the bout's copy of its rules
 * pins, else the built-in. Two bouts of one Tournament can hold two copies that
 * pin two card rulesets, so the catalogue is kept on the tablet BY THE CARD
 * RULESET IT IS: under `card/<its id>`, and `card/built-in` for the built-in.
 * The key comes from the ANSWER, never from the bout read before it: if the
 * organiser changes the card rules between the two requests, the catalogue
 * still lands under its own name.
 *
 * With no network a bout reads the key its rules name (`cardCatalogueKey`).
 * Without its rules, or before that catalogue was ever read, it takes the
 * catalogue its Tournament's bouts gave last (ruling J, "last seen"), kept
 * beside it; a bout read without its summary names no Tournament and keeps it
 * by its own path, as it did. A bout the tablet never opened then still has a
 * catalogue: without one the penalty picker is empty.
 */
import { fetchWithCache, readCached, writeCached } from '../offline/cached-reads';

/** Where the catalogue of a Tournament's bouts, last read, is kept in the tablet's `reads` table. */
export const catalogueKey = (tournamentId: string) => `penalty-ruleset/tournament/${tournamentId}`;

/** Where the catalogue of a card ruleset is kept; null is the built-in. */
export const cardCatalogueKey = (cardRulesetId: string | null) =>
  `penalty-ruleset/card/${cardRulesetId ?? 'built-in'}`;

/** Where one bout's catalogue may be kept: its card rules', and its Tournament's. */
export interface CatalogueKeys {
  /** `cardCatalogueKey` of the bout's rules; null for a bout read without them. */
  cardKey?: string | null;
  tournamentId?: string | null;
}

export async function readPenaltyCatalogue<T>(
  apiUrl: string,
  matchId: string,
  { cardKey, tournamentId }: CatalogueKeys,
  signal?: AbortSignal,
): Promise<{ body: T; fetchedAt: number; fresh: boolean } | null> {
  const path = `/api/v1/matches/${matchId}/penalty-ruleset`;
  // Kept as the Tournament's last (or by the bout's path); with no answer, that is the fallback.
  const lastSeen = tournamentId ? catalogueKey(tournamentId) : path;
  const read = await fetchWithCache<T>(apiUrl, path, { credentials: 'include', signal }, lastSeen);
  if (read?.fresh) {
    // A store that refuses the write costs the next read with no network only.
    await Promise.all(cardKeysOf(read.body).map((key) => writeCached(key, read.body))).catch(
      () => undefined,
    );
    return read;
  }
  const own = cardKey ? await readCached<T>(cardKey) : null;
  return own ? { ...own, fresh: false } : read;
}

/**
 * The card keys an answer is kept under. A null answer (no built-in row on the
 * server) names no card ruleset: it is kept as the Tournament's last only.
 */
function cardKeysOf(body: unknown): string[] {
  const answer = body as { id?: unknown; built_in?: unknown } | null;
  if (!answer || typeof answer.id !== 'string') return [];
  return answer.built_in === true
    ? [cardCatalogueKey(answer.id), cardCatalogueKey(null)]
    : [cardCatalogueKey(answer.id)];
}
