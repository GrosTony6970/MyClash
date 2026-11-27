/**
 * What the forfeit panel asks, and what it sends (`POST /matches/:id/forfeit`).
 *
 * A forfeit names its side by exactly one of `forfeitingRegistrationId` or `forfeitingTeamId`
 * (call 8). A team has no Fighter status, so the panel never asks "can the Fighter continue?"
 * for a team, and sends no answer: the server refuses `canContinue` on a team's forfeit (call 4).
 *
 * Pure, out of the component: web-staff has no React test setup.
 */
import type { ForfeitQuestion } from '@myclash/types/forfeit-rules';
import type { QueuedSide } from '../offline/queued-side';

/** The question of the rules for this side: a team's forfeit asks nothing. */
export function forfeitQuestionFor(
  question: ForfeitQuestion,
  side: QueuedSide | null,
): ForfeitQuestion {
  return side?.kind === 'team' ? { ask: false, unconfirmed: false } : question;
}

export interface ForfeitChoice {
  side: QueuedSide;
  reason: string;
  /** The answer to "can the Fighter continue?", sent only when the question is asked. */
  canContinue: boolean;
  question: ForfeitQuestion;
  note: string;
}

/** The body of the forfeit: its side, its reason, the answer when asked, and a note. */
export function forfeitBody({ side, reason, canContinue, question, note }: ForfeitChoice) {
  const asked = forfeitQuestionFor(question, side).ask;
  return {
    ...(side.kind === 'team'
      ? { forfeitingTeamId: side.id }
      : { forfeitingRegistrationId: side.id }),
    reason,
    canContinue: asked ? canContinue : undefined,
    note: note.trim() || undefined,
  };
}
