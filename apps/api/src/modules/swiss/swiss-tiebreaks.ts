import type { RankingRule } from '@myclash/rulesets';
import type { SwissTiebreakKey } from './dto/swiss-config.dto';

/**
 * The Swiss tiebreak keys, computed from who played whom.
 *
 * Pure — no DB, no Nest. These are the keys `applyRanking` cannot derive on its
 * own: it reads `Number(row.stats[key] ?? 0)` and knows nothing about
 * opponents, so every opponent-derived measure has to be materialised into
 * `stats` before ranking runs.
 *
 * A BYE CONTRIBUTES ZERO to Buchholz and Sonneborn-Berger. That is deliberate
 * and it is a real (documented) simplification: FIDE credits a virtual opponent
 * so a fighter is not punished for the field being odd. Implementing that is a
 * follow-up; until then a bye is simply not a bout and adds nothing to a
 * measure that sums over opponents.
 */

export type SwissOutcome = 'win' | 'draw' | 'loss';

export interface SwissResultRecord {
  registrationId: string;
  swissPts: number;
  /** One entry per bout actually played. Byes are NOT bouts. */
  bouts: Array<{ opponentId: string; outcome: SwissOutcome }>;
}

export interface OpponentTiebreaks {
  buchholz: number;
  buchholzCut1: number;
  sonnebornBerger: number;
  opponentWinPct: number;
}

/**
 * Every opponent-derived key, for every fighter.
 *
 * Needs the WHOLE field at once — each fighter's Buchholz is a sum over other
 * fighters' totals, so no fighter can be computed in isolation. That is why
 * this is a separate pass rather than part of the per-fighter accumulation.
 */
export function opponentTiebreaks(records: SwissResultRecord[]): Map<string, OpponentTiebreaks> {
  const pointsOf = new Map(records.map((r) => [r.registrationId, r.swissPts]));
  const boutsOf = new Map(records.map((r) => [r.registrationId, r.bouts]));

  const out = new Map<string, OpponentTiebreaks>();
  for (const record of records) {
    // An opponent outside the field (withdrawn and removed, or a data error)
    // scores 0 rather than breaking the sum.
    const opponentPoints = record.bouts.map((b) => pointsOf.get(b.opponentId) ?? 0);
    const buchholz = opponentPoints.reduce((sum, p) => sum + p, 0);

    // Cut-1 drops the WEAKEST opponent, damping the one freak pairing that can
    // otherwise decide a podium. With no bouts there is nothing to cut.
    const buchholzCut1 = opponentPoints.length === 0 ? 0 : buchholz - Math.min(...opponentPoints);

    // Sonneborn-Berger weights an opponent's strength by how you did against
    // them: all of it for a win, half for a draw, none for a loss.
    const sonnebornBerger = record.bouts.reduce((sum, bout) => {
      const opponent = pointsOf.get(bout.opponentId) ?? 0;
      if (bout.outcome === 'win') return sum + opponent;
      if (bout.outcome === 'draw') return sum + opponent / 2;
      return sum;
    }, 0);

    let opponentWins = 0;
    let opponentBouts = 0;
    for (const bout of record.bouts) {
      const theirs = boutsOf.get(bout.opponentId) ?? [];
      opponentWins += theirs.filter((b) => b.outcome === 'win').length;
      opponentBouts += theirs.length;
    }
    const opponentWinPct = opponentBouts === 0 ? 0 : opponentWins / opponentBouts;

    out.set(record.registrationId, {
      buchholz,
      buchholzCut1,
      // Rounded like `score` so the displayed number and the ranked number are
      // the same value — a tiebreak the reader cannot reproduce is not one.
      sonnebornBerger: round2(sonnebornBerger),
      opponentWinPct: round2(opponentWinPct),
    });
  }
  return out;
}

/**
 * Net result inside one tied block: wins minus losses against the OTHER members
 * of that block.
 *
 * Head-to-head is not a scalar over the field — "who beat whom among the people
 * still level with me" depends on who those people turn out to be, which is only
 * known after ranking with the chain up to this key. Hence the third pass.
 */
export function headToHeadWithin(
  blockIds: string[],
  records: SwissResultRecord[],
): Map<string, number> {
  const block = new Set(blockIds);
  const out = new Map<string, number>();

  for (const record of records) {
    if (!block.has(record.registrationId)) continue;
    let net = 0;
    for (const bout of record.bouts) {
      if (!block.has(bout.opponentId)) continue;
      if (bout.outcome === 'win') net += 1;
      else if (bout.outcome === 'loss') net -= 1;
    }
    out.set(record.registrationId, net);
  }
  return out;
}

/**
 * Turn the organiser's configured chain into the RankingRule[] `applyRanking`
 * consumes.
 *
 * The primary key comes first and is not part of the configurable chain: it is
 * `swissPts` or the ruleset `score` per `rankBy`, and ranking on anything else
 * first would not be a Swiss standings table.
 *
 * `rulesetChain` is a SENTINEL, not a stat — it splices the ruleset's own
 * rankingChain in at that position, so an organiser can say "Buchholz first,
 * then whatever this ruleset normally does" without restating the ruleset.
 */
export function buildSwissRankingChain(
  rankBy: 'swissPts' | 'rulesetScore',
  tiebreakChain: SwissTiebreakKey[],
  rulesetChain: RankingRule[],
): RankingRule[] {
  const primary: RankingRule = {
    key: rankBy === 'rulesetScore' ? 'score' : 'swissPts',
    direction: 'desc',
  };

  const rest: RankingRule[] = [];
  for (const key of tiebreakChain) {
    if (key === 'rulesetChain') {
      rest.push(...rulesetChain);
      continue;
    }
    rest.push({ key, direction: directionFor(key) });
  }

  // The primary can also appear inside a spliced ruleset chain; drop repeats so
  // a duplicated key cannot mask the one before it.
  const seen = new Set<string>([primary.key]);
  const deduped = rest.filter((rule) => {
    if (seen.has(rule.key)) return false;
    seen.add(rule.key);
    return true;
  });

  // The other primary candidate still ranks after the chain: whichever of
  // swissPts / score is not primary stays a meaningful last resort.
  const fallback = rankBy === 'rulesetScore' ? 'swissPts' : 'score';
  if (!seen.has(fallback)) deduped.push({ key: fallback, direction: 'desc' });

  return [primary, ...deduped];
}

/**
 * More is better for every Swiss tiebreak except the two that count damage
 * taken. `hitsReceived` and `doubles` are the exceptions, and they come from
 * the shared pool helper rather than from this module.
 */
function directionFor(key: SwissTiebreakKey): 'asc' | 'desc' {
  return key === 'hitsReceived' || key === 'doubles' ? 'asc' : 'desc';
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
