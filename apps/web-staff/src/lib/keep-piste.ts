/**
 * Reads the piste and keeps it on the tablet: its bouts, their order, and the
 * rules and the penalty catalogue of each Tournament on it (quick-win ruling 4).
 *
 * Story. The wifi drops at piste 2 for forty minutes. Bout 1 ends on the tablet
 * and the official taps "Next match". The tablet had kept a bout only after its
 * own screen read it, so bout 2 was nowhere on it. With the piste kept while
 * the wifi was good, bout 2 opens from its copy, and bout 3 after it.
 *
 * WHICH BOUTS ARE KEPT. A copy read ahead is the bout's row and its names,
 * with no clock, no hits and no cards. That is the whole truth of a bout NOT
 * STARTED, and of no other. So a bout is kept when:
 *   - it has its names (the bout screen does not keep a bout without them);
 *   - the tablet holds the scoring rules of its Tournament. A copy with no
 *     rules opens with the default buttons and says nothing: a +2 tapped where
 *     the Tournament says +3 is stored as a 2;
 *   - it is not started, or the tablet holds its clock (its own screen opened
 *     it, and keeps its clock and its lists). A bout in play on another tablet,
 *     read ahead, would open here at 0:00 with Start and no double counted.
 * A bout that is not kept stays in the order: its tile leads to "not loaded",
 * which is true.
 *
 * Not kept either: the prior cards of a bout's fighters (`penalty-scope`). A
 * card given with no network in a bout read ahead is worded as a first offence
 * and not priced until the server takes it, the pad's rule whenever that read
 * is missing.
 */
import type { MatchInfo } from '../components/MatchView';
import { clocksHeld, keepBoutsAskedAt } from '../offline/kept-bout';
import { keepPiste } from '../offline/kept-piste';
import { readMatchConfig } from './match-config-read';
import { readPenaltyCatalogue } from './penalty-catalogue';
import { readPiste, type PisteRead } from './piste-read';

/**
 * The Tournaments of these bouts whose rules the tablet holds after asking for
 * them: just read, or kept from before. The catalogue is asked beside them, by
 * one bout per Tournament; without it the penalty picker is empty, which the
 * official sees.
 */
async function tournamentsWithRules(apiUrl: string, bouts: MatchInfo[]): Promise<Set<string>> {
  const firstOf = new Map<string, string>();
  for (const { id, tournamentId } of bouts) {
    if (tournamentId && !firstOf.has(tournamentId)) firstOf.set(tournamentId, id);
  }
  const held = new Set<string>();
  for (const [tournamentId, matchId] of firstOf) {
    if (await readMatchConfig(apiUrl, tournamentId)) held.add(tournamentId);
    await readPenaltyCatalogue(apiUrl, matchId, tournamentId);
  }
  return held;
}

/**
 * One read, and what came of it. Anything but `piste` changed nothing on the
 * tablet: no network, a refusal and a fault all keep what it holds.
 */
export async function keepPisteOf(
  apiUrl: string,
  liceId: string,
  fetchFn: typeof fetch = fetch,
): Promise<PisteRead['kind']> {
  // Before the request: a copy of a later ask is newer than this answer
  // (`keepBoutsAskedAt`).
  const askedAt = Date.now();
  const read = await readPiste(apiUrl, liceId, fetchFn);
  if (read.kind !== 'piste') return read.kind;

  const named = read.bouts.filter((bout) => bout.labelled).map((bout) => bout.match);
  const ruled = await tournamentsWithRules(apiUrl, named);
  const opened = await clocksHeld(named.map((bout) => bout.id));
  const whole = named.filter(
    (bout) =>
      ruled.has(bout.tournamentId ?? '') && (bout.status === 'scheduled' || opened.has(bout.id)),
  );
  await keepBoutsAskedAt(whole, askedAt);
  await keepPiste(
    liceId,
    read.bouts.map((bout) => bout.match.id),
    askedAt,
  );
  return 'piste';
}
