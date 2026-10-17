/**
 * The end decision the pad asks with for one bout (ruling "TF_v1 version",
 * 2026-10-16: a ruleset version keeps the decision of its day).
 *
 * The server sends it with the bout (`decision_edition`, the edition of the
 * bout's OWN ruleset version), on both routes a bout reaches the tablet by.
 * A bout carries none the pad knows when the tablet kept it from an older
 * bundle, when the server could not read it, or when it names an edition newer
 * than this bundle: the pad then decides with today's, and says so once per
 * bout, since the server decides by the bout's own version and the two may
 * differ. Checked here, an unknown name never reaches a decider, which would
 * throw on it.
 *
 * Pure but for the warning.
 */
import { EDITION_2026_10, isDecisionEdition, type DecisionEdition } from '@myclash/types';
import type { MatchInfo } from '../components/MatchView';

const warned = new Set<string>();

export function editionOf(match: Pick<MatchInfo, 'id' | 'decisionEdition'>): DecisionEdition {
  if (isDecisionEdition(match.decisionEdition)) return match.decisionEdition;
  if (!warned.has(match.id)) {
    warned.add(match.id);
    console.warn(
      `Bout ${match.id}: no end-decision edition this pad knows (${String(match.decisionEdition)}); deciding with today's`,
    );
  }
  return EDITION_2026_10;
}
