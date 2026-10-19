/**
 * Reads the piste and keeps it on the tablet: its bouts with their own rules,
 * their order, the `/match-config` of each Tournament on it and the penalty
 * catalogue of each card ruleset its bouts name (quick-win ruling 4).
 *
 * Story. The wifi drops at piste 2 for forty minutes. Bout 1 ends on the tablet
 * and the official taps "Next match". The tablet had kept a bout only after its
 * own screen read it, so bout 2 was nowhere on it. With the piste kept while
 * the wifi was good, bout 2 opens from its copy, and bout 3 after it.
 *
 * WHICH BOUTS ARE KEPT. A copy read ahead is the bout's row and its names,
 * with no clock, no hits and no cards. That is the whole truth of a bout NOT
 * STARTED, and of no other. So a bout is kept when:
 *   - it carries its own rules (ruling K), and the tablet holds its
 *     Tournament's `/match-config`, the display. A copy with neither opens with
 *     the default buttons: a +2 tapped where the bout says +3 is stored as a 2.
 *     A bout with no summary names no Tournament, so it has no display, and no
 *     names either: the bout screen does not keep such a bout;
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
import { unsentStarts } from '../offline/press-queue';
import { readMatchConfig } from './match-config-read';
import { cardCatalogueKey, readPenaltyCatalogue } from './penalty-catalogue';
import { readPiste, type PisteRead } from './piste-read';

/**
 * The Tournaments of these bouts whose `/match-config` the tablet holds after
 * asking for it, just read or kept from before: their display (the side
 * colours tell the referee which side to tap) and the rules of a bout read
 * without its own.
 */
async function tournamentsWithConfig(apiUrl: string, bouts: MatchInfo[]): Promise<Set<string>> {
  const tournaments = new Set<string>();
  for (const { tournamentId } of bouts) if (tournamentId) tournaments.add(tournamentId);
  const held = new Set<string>();
  for (const tournamentId of tournaments) {
    if (await readMatchConfig(apiUrl, tournamentId)) held.add(tournamentId);
  }
  return held;
}

/**
 * The penalty catalogue of each card ruleset the bouts' rules name, asked by one
 * bout each (`penalty-catalogue.ts`). A bout read without its rules is not kept,
 * so its catalogue is not asked. Without one the penalty picker is empty, which
 * the official sees. A catalogue not read (the tablet's store refusing it) keeps
 * nothing from being kept.
 */
async function keepCatalogues(apiUrl: string, bouts: MatchInfo[]): Promise<void> {
  const firstOf = new Map<string, MatchInfo>();
  for (const bout of bouts) {
    if (!bout.rules) continue;
    const cardKey = cardCatalogueKey(bout.rules.cardRulesetId);
    if (!firstOf.has(cardKey)) firstOf.set(cardKey, bout);
  }
  for (const [cardKey, bout] of firstOf) {
    const keys = { cardKey, tournamentId: bout.tournamentId };
    await readPenaltyCatalogue(apiUrl, bout.id, keys).catch(() => null);
  }
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
  // Before the request too: a Start leaves the queue only once the server took it, so a bout whose
  // Start waits now is answered `scheduled` and keeps its rules (`withHeldRules`). A store that
  // fails costs that rule, never the keep.
  const waiting = await unsentStarts().catch(() => new Map<string, string>());
  const read = await readPiste(apiUrl, liceId, fetchFn);
  if (read.kind !== 'piste') return read.kind;

  const configured = await tournamentsWithConfig(apiUrl, read.bouts);
  await keepCatalogues(apiUrl, read.bouts);
  const opened = await clocksHeld(read.bouts.map((bout) => bout.id));
  const whole = read.bouts.filter(
    (bout) =>
      bout.rules !== undefined &&
      configured.has(bout.tournamentId ?? '') &&
      (bout.status === 'scheduled' || opened.has(bout.id)),
  );
  await keepBoutsAskedAt(whole, askedAt, waiting);
  await keepPiste(
    liceId,
    read.bouts.map((bout) => bout.id),
    askedAt,
  );
  return 'piste';
}
