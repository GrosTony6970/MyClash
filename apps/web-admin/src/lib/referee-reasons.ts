/**
 * The referee checker's reasons (ADR-016) as the admin screens use them.
 *
 * The words themselves live beside the checker, in
 * `@myclash/rulesets/scheduling/referee-reason-text` (the API words them too);
 * `referee-reasons.test.ts` checks them in EN + FR.
 *
 * Types only from the checker: nothing here ships its logic to the bundle.
 */
import { failureMessage, type ApiFailure } from '@myclash/api-client';
import type { RefereeReason, RefereeVerdict } from '@myclash/rulesets/scheduling/referee-checker';
import {
  refereeReasonsText,
  type RefereeReasonTextCode,
  type Translate,
} from '@myclash/rulesets/scheduling/referee-reason-text';

/** Why a candidate is amber or greyed out in the picker, as the board sends it. */
export interface PickerReason {
  code: RefereeReasonTextCode;
  /** The data name it clashes with; '' when there is none. */
  label: string;
}

/**
 * One existing duty the one checker has something to say about — the API's
 * `RefereeConflictEntry`: red when Impossible, amber when Discouraged, each reason the
 * organiser already confirmed over marked `confirmed` (ruling 135).
 */
export interface RefereeConflictEntry {
  assignmentId: string;
  personId: string;
  personName: string;
  unitId: string;
  /** The Tournament and the unit, as the board names it. */
  unitName: string;
  tournamentId: string;
  role: string;
  start: string | null;
  level: RefereeVerdict['level'];
  reasons: RefereeReason[];
}

/** The two refusals an assign door answers 409 with (ADR-016, ruling 22), or null. */
export function refereeRefusal(failure: ApiFailure): RefereeRefusal | null {
  if (failure.kind !== 'http' || failure.status !== 409) return null;
  const level =
    failure.code === 'referee_impossible'
      ? 'impossible'
      : failure.code === 'referee_needs_confirmation'
        ? 'discouraged'
        : null;
  if (!level) return null;
  const raw = failure.details?.['reasons'];
  const reasons = (Array.isArray(raw) ? raw : []).filter(
    (r): r is RefereeReason =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as { code?: unknown }).code === 'string' &&
      typeof (r as { level?: unknown }).level === 'string',
  );
  return { level, reasons };
}

/**
 * The lock's 409 (ADR-019): the duties that break a rule with no override, which the
 * organiser reassigns or sends anyway. Null for any other failure.
 */
export function lockRefusal(failure: ApiFailure): LockRefusedDuty[] | null {
  if (failure.kind !== 'http' || failure.status !== 409) return null;
  if (failure.code !== 'referee_lock_impossible') return null;
  const raw = failure.details?.['conflicts'];
  return (Array.isArray(raw) ? raw : []).filter(
    (c): c is LockRefusedDuty =>
      typeof c === 'object' &&
      c !== null &&
      Array.isArray((c as { reasons?: unknown }).reasons) &&
      typeof (c as { key?: unknown }).key === 'string',
  );
}

/** A duty that refused the lock, with the key "send anyway" confirms it by (ruling 138). */
export type LockRefusedDuty = RefereeConflictEntry & { key: string };

/** An assign door's 409: the checker's level and every reason, as the API sent them. */
export interface RefereeRefusal {
  level: 'impossible' | 'discouraged';
  reasons: RefereeReason[];
}

/**
 * What to tell the organiser when an assign did not land: the locked board in their
 * language, the checker's reasons when it refused, else the API's own words
 * (`failureMessage`, with the caller's fallback). Null,
 * as `failureMessage` answers, for an aborted request: there is nothing to say.
 */
export function assignFailureText(
  t: Translate,
  failure: ApiFailure,
  fallback: string,
): string | null {
  if (failure.kind === 'http' && failure.code === 'referee_board_locked') {
    return t('organizer.refereeBoard.boardLocked');
  }
  const refusal = refereeRefusal(failure);
  if (!refusal) return failureMessage(failure, t, fallback);
  const reasons = refereeReasonsText(t, refusal.reasons);
  return refusal.level === 'impossible'
    ? t('organizer.refereeBoard.assignImpossible', { reasons })
    : t('organizer.refereeBoard.assignNeedsConfirm', { reasons });
}
