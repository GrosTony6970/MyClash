/**
 * A correction, described BEFORE it is written.
 *
 * Ruling 226: a correction lands whole or not at all. There is no transaction
 * through supabase-js, so "not at all" means the door asks first and writes
 * only on a yes. To ask, it says what it is about to do to the sheet, and the
 * score is derived from the sheet as it WOULD read.
 */
import { ConflictException } from '@nestjs/common';
import type { CorrectionRefusalCode } from './correction-outcome';

/** The rows a score is derived from: live exchanges and live cards. */
export interface ScoreRows {
  rawRows: Record<string, unknown>[];
  penaltyRows: Record<string, unknown>[];
}

export interface ScoreChange {
  /** Exchanges about to be voided. */
  dropExchangeIds?: string[];
  /** Voided exchanges about to be restored: the scorer reads their rows. */
  restoreExchangeIds?: string[];
  /** Exchanges about to be inserted, as `exchanges` rows. */
  addExchanges?: Record<string, unknown>[];
  /** Cards about to be voided. */
  dropPenaltyIds?: string[];
}

/** The sheet as it would read once the change is in. `restored` are the rows of `restoreExchangeIds`. */
export function applyScoreChange(
  rows: ScoreRows,
  change: ScoreChange,
  restored: Record<string, unknown>[],
): ScoreRows {
  const dropped = new Set(change.dropExchangeIds);
  const droppedCards = new Set(change.dropPenaltyIds);
  return {
    rawRows: [
      ...rows.rawRows.filter((row) => !dropped.has(row['id'] as string)),
      ...restored,
      ...(change.addExchanges ?? []),
    ],
    penaltyRows: rows.penaltyRows.filter((row) => !droppedCards.has(row['id'] as string)),
  };
}

/**
 * The refusal, in the object form the pad and web-admin map by `code`: a bare
 * string would put this English sentence in front of a French referee.
 */
const MESSAGES: Record<CorrectionRefusalCode, string> = {
  correction_later_bout_fought:
    'A later bout was already fought from this result. The correction would change who won, so it was not applied.',
  correction_leaves_bout_level:
    'The correction would leave this bout level, and its rules do not let it end as a draw. It was not applied.',
};

export function correctionRefused(code: CorrectionRefusalCode): ConflictException {
  return new ConflictException({ message: MESSAGES[code], code });
}
