/**
 * write-verdict.ts — how a door that WRITES a referee refuses (ADR-016).
 *
 * Every assign door — the board's Assign, the per-bout and per-Pool crew of the Pools page,
 * the AI assistant's apply — refuses the same way:
 *   - a person off the Event's referee roster, or without the role's skill: 400. A skill is
 *     not a scheduling rule, so it comes before the checker (operator ruling 136);
 *   - Impossible: 409 `referee_impossible`, whatever the request says;
 *   - Discouraged: 409 `referee_needs_confirmation` unless the request confirms. What was
 *     confirmed over is what the door stores on the row (`toStoredReasons`, ruling 22).
 * The message names each reason by code and data name: the AI assistant keeps nothing but
 * the message on a draft that failed.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  toStoredReasons,
  type RefereeReason,
  type RefereeVerdict,
  type StoredRefereeReason,
} from '@myclash/rulesets/scheduling/referee-checker';
import type { AssignmentBoardCandidate } from './assignment-board.service';

export function qualifiedCandidate(
  candidates: readonly AssignmentBoardCandidate[],
  personId: string,
  role: string,
): AssignmentBoardCandidate {
  const candidate = candidates.find((c) => c.personId === personId);
  if (!candidate) throw new BadRequestException('Selected referee is not on this event roster');
  if (!candidate.qualifications.some((q) => q.role === role)) {
    throw new BadRequestException('Selected referee is not qualified for this role');
  }
  return candidate;
}

const listed = (reasons: readonly RefereeReason[], level: RefereeReason['level']): string =>
  reasons
    .filter((r) => r.level === level)
    .map((r) => (r.against ? `${r.code} (${r.against.label})` : r.code))
    .join(', ');

/** The reasons to store on the row, or the door's 409. */
export function refuseUnlessFine(verdict: RefereeVerdict, confirm: boolean): StoredRefereeReason[] {
  if (verdict.level === 'impossible') {
    throw new ConflictException({
      code: 'referee_impossible',
      message: `This referee cannot take this slot: ${listed(verdict.reasons, 'impossible')}`,
      level: verdict.level,
      reasons: verdict.reasons,
    });
  }
  if (verdict.level === 'discouraged' && !confirm) {
    throw new ConflictException({
      code: 'referee_needs_confirmation',
      message: `Assigning this referee needs confirmation: ${listed(verdict.reasons, 'discouraged')}`,
      level: verdict.level,
      reasons: verdict.reasons,
    });
  }
  return toStoredReasons(verdict);
}
