/**
 * Reads the piste and keeps it on the tablet: every bout, their order, and the
 * rules and the penalty catalogue of each Tournament on it (quick-win ruling 4).
 *
 * Story. The wifi drops at piste 2 for forty minutes. Bout 1 ends on the tablet
 * and the official taps "Next match". The tablet had kept a bout only after its
 * own screen read it, so bout 2 was nowhere on it. With the piste kept while
 * the wifi was good, bout 2 opens from its copy, and bout 3 after it.
 *
 * WHAT IS KEPT of a bout read ahead is its row and its names, not its clock,
 * its hits or its cards: for a bout not started there are none. The prior
 * cards of its fighters (`penalty-scope`) are not kept either: a card given
 * with no network in such a bout is worded as a first offence and not priced
 * until the server takes it (the pad's rule whenever that read is missing).
 *
 * A bout with no summary has no names: it is not kept, as the bout screen does
 * not keep it. Its id stays in the order.
 */
import { keepBoutsAskedAt } from '../offline/kept-bout';
import { keepPiste } from '../offline/kept-piste';
import { readMatchConfig } from './match-config-read';
import { readPenaltyCatalogue } from './penalty-catalogue';
import { readPiste, type PisteRead } from './piste-read';

/**
 * One read, and what came of it. Anything but `piste` changed nothing on the
 * tablet: no network, a refusal and a fault all keep what it holds.
 */
export async function keepPisteOf(
  apiUrl: string,
  liceId: string,
  fetchFn: typeof fetch = fetch,
): Promise<PisteRead['kind']> {
  // Before the request: a copy the bout screen writes while this read is on
  // its way is newer than its answer (`keepBoutsAskedAt`).
  const askedAt = Date.now();
  const read = await readPiste(apiUrl, liceId, fetchFn);
  if (read.kind !== 'piste') return read.kind;

  const named = read.bouts.filter((bout) => bout.labelled).map((bout) => bout.match);
  await keepBoutsAskedAt(named, askedAt);
  await keepPiste(
    liceId,
    read.bouts.map((bout) => bout.match.id),
    askedAt,
  );

  // One bout per Tournament: the catalogue is asked by bout and kept by Tournament.
  const firstOf = new Map<string, string>();
  for (const { id, tournamentId } of named) {
    if (tournamentId && !firstOf.has(tournamentId)) firstOf.set(tournamentId, id);
  }
  for (const [tournamentId, matchId] of firstOf) {
    await readMatchConfig(apiUrl, tournamentId);
    await readPenaltyCatalogue(apiUrl, matchId, tournamentId);
  }
  return 'piste';
}
