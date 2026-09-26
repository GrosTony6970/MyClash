/**
 * The words for the one referee checker's reasons (ADR-016), for every screen.
 *
 * The checker says WHY by code; each surface — the picker, the referee workspace's
 * conflict list, the schedule board's two banners, the Pools page — used to word its
 * own list of reasons, and they disagreed. They all come here now.
 *
 * A `switch` of literal `t()` calls, not a lookup by template: the i18n sweep resolves
 * keys it can read at the call site, and a template would whitelist every key under the
 * prefix without proving one resolves. The switch is exhaustive — a code the checker adds
 * is a compile error here until it has words (`referee-reasons.test.ts` checks EN + FR).
 *
 * Types only from the checker: nothing here ships its logic to the bundle.
 */
import { failureMessage, type ApiFailure } from '@myclash/api-client';
import type {
  RefereeReason,
  RefereeReasonCode,
  RefereeVerdict,
} from '@myclash/rulesets/scheduling/referee-checker';

/** A checker code, or the picker's own "holds no skill this slot allows". */
export type RefereeReasonTextCode = RefereeReasonCode | 'missing_qualification';

type Translate = (key: string, values?: Record<string, string>) => string;

/** One reason, said after the person's name. `against` is the data name it clashes with. */
export function refereeReasonText(
  t: Translate,
  code: RefereeReasonTextCode,
  against: string,
): string {
  const v = { against };
  switch (code) {
    case 'own_match':
      return t('organizer.refereeBoard.reasons.own_match', v);
    case 'fights_overlap':
      return t('organizer.refereeBoard.reasons.fights_overlap', v);
    case 'referees_overlap':
      return t('organizer.refereeBoard.reasons.referees_overlap', v);
    case 'teaches_overlap':
      return t('organizer.refereeBoard.reasons.teaches_overlap', v);
    case 'outside_availability':
      return t('organizer.refereeBoard.reasons.outside_availability');
    case 'own_pool':
      return t('organizer.refereeBoard.reasons.own_pool', v);
    case 'own_pool_span':
      return t('organizer.refereeBoard.reasons.own_pool_span', v);
    case 'two_roles':
      return t('organizer.refereeBoard.reasons.two_roles', v);
    case 'attends_overlap':
      return t('organizer.refereeBoard.reasons.attends_overlap', v);
    case 'missing_qualification':
      return t('organizer.refereeBoard.reasons.missing_qualification');
  }
}

/** A reason as the checker hands it: a code and what it is against (null for availability). */
export interface RefereeReasonLike {
  code: RefereeReasonTextCode;
  against?: { label: string } | null;
  /** The label a picker or stored reason carries instead of an `against`. */
  label?: string;
}

/** Several reasons, as one line. */
export function refereeReasonsText(t: Translate, reasons: readonly RefereeReasonLike[]): string {
  return reasons
    .map((r) => refereeReasonText(t, r.code, r.against?.label ?? r.label ?? ''))
    .join('; ');
}

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
export function lockRefusal(failure: ApiFailure): RefereeConflictEntry[] | null {
  if (failure.kind !== 'http' || failure.status !== 409) return null;
  if (failure.code !== 'referee_lock_impossible') return null;
  const raw = failure.details?.['conflicts'];
  return (Array.isArray(raw) ? raw : []).filter(
    (c): c is RefereeConflictEntry =>
      typeof c === 'object' && c !== null && Array.isArray((c as { reasons?: unknown }).reasons),
  );
}

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
