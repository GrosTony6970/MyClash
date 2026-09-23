/** What a restore answers that the archive page reads. */
export interface RestoreAnswer {
  /** Penalty ruleset pins the restore cleared: the target club may not use them. */
  droppedPenaltyRulesetPins?: number;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The success line after a restore. A restore clears every Event and Tournament
 * penalty ruleset pin the target club may not pin (operator ruling 67), and the
 * organiser is told how many, or the restored copy would quietly score cards
 * under a different ruleset than the archive named.
 */
export function restoredNotice(t: Translate, answer: RestoreAnswer): string {
  const started = t('organizer.archive.restoreStarted');
  const dropped = answer.droppedPenaltyRulesetPins ?? 0;
  if (dropped === 0) return started;
  return `${started} ${t('organizer.archive.restoreDroppedPenaltyPins', { count: dropped })}`;
}
