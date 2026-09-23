/** What a restore answers that the archive page reads. */
export interface RestoreAnswer {
  /** Penalty ruleset pins the restore cleared: the target club may not use them. */
  droppedPenaltyRulesetPins?: number;
  /** Event compensation settings the restore dropped: the club may not use their plan. */
  droppedCompensationPlans?: number;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The success line after a restore. A restore clears every Event and Tournament
 * penalty ruleset pin the target club may not pin (operator ruling 67), and
 * drops the compensation settings of an Event whose plan it may not use (ruling
 * 69). The organiser is told how many of each, or the restored copy would
 * quietly score cards or pay referees under definitions other than the archive
 * named.
 */
export function restoredNotice(t: Translate, answer: RestoreAnswer): string {
  const lines = [t('organizer.archive.restoreStarted')];
  const pins = answer.droppedPenaltyRulesetPins ?? 0;
  if (pins > 0) lines.push(t('organizer.archive.restoreDroppedPenaltyPins', { count: pins }));
  const plans = answer.droppedCompensationPlans ?? 0;
  if (plans > 0)
    lines.push(t('organizer.archive.restoreDroppedCompensationPlans', { count: plans }));
  return lines.join(' ');
}
