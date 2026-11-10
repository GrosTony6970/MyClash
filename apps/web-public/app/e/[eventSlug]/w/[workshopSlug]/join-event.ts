import { apiRequest, failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';
import type { UnknownCaller, WorkshopBooking } from '@/components/me/workshop-booking';

/** A tap the booking door refused as a stranger's, with who the stranger was. */
export interface StrangerTap {
  who: UnknownCaller;
  sessionId: string;
  booking: WorkshopBooking;
}

/** The typed names, sent only when the account has no profile to take them from. */
export interface JoinNames {
  givenName: string;
  familyName: string;
}

/**
 * One join (rulings 516, 568): the account puts itself on the Event's list. `names` means the page
 * must ask for a name first (the account has no profile); any other refusal is said in words.
 */
export type JoinResult = { ok: true } | { ok: false; names: true } | { ok: false; words: string };

/** The refusals the join route names, in the page's own words (never the organiser-facing ones). */
const REASONS: Record<string, string> = {
  sameName: 'publicApp.workshopDetail.join.sameName',
  yourProfile: 'publicApp.workshopDetail.join.yourProfile',
  yourAddress: 'publicApp.workshopDetail.join.yourAddress',
};

export function joinRefusalWords(failure: ApiFailure, t: (key: string) => string): string {
  const code = failureCode(failure);
  if (code === 'ASK_ORGANISER') {
    const reason = failure.kind === 'http' ? failure.details?.['reason'] : undefined;
    const key = typeof reason === 'string' ? REASONS[reason] : undefined;
    return t(key ?? 'publicApp.workshopDetail.accountNotOnRoster');
  }
  if (code === 'SELF_JOIN_CLOSED') return t('publicApp.workshopDetail.join.closed');
  if (code === 'event_completed' || code === 'event_archived') {
    return t('publicApp.workshopDetail.join.ended');
  }
  // Any other refusal by the server (a lost race, a database message, names of spaces only) has
  // no words for the public in it: its English `detail` must not reach the page (rule 6).
  if (refusedByServer(failure)) return t('publicApp.workshopDetail.join.failed');
  // A lapsed login (401), a rate limit, the network, a 5xx: the shared words say what to do.
  return failureMessage(failure, t, t('publicApp.workshopDetail.join.failed')) ?? '';
}

/**
 * What a Workshop page offers a caller its door did not know: the join, when the Event lets people
 * join by themselves (rulings 516, 568) and its read is in; else nothing, and today's notices.
 */
export function joinOffer(
  event: { id: string; workshopSelfJoin: boolean } | null,
  apiUrl: string,
): JoinOffer | null {
  return event?.workshopSelfJoin === true ? { apiUrl, eventId: event.id } : null;
}

/** Where a join goes; the page hands the booking that follows it as its own handler prop. */
export interface JoinOffer {
  apiUrl: string;
  eventId: string;
}

function refusedByServer(failure: ApiFailure): boolean {
  if (failure.kind === 'http') return failure.status < 500 && failure.status !== 429;
  return failure.kind === 'unauthenticated' && failure.status === 403;
}

export async function joinEvent(
  apiUrl: string,
  eventId: string,
  names: JoinNames | null,
  t: (key: string) => string,
): Promise<JoinResult> {
  const result = await apiRequest<unknown>(apiUrl, `/api/v1/me/events/${eventId}/join`, {
    method: 'POST',
    body: names ?? {},
  });
  if (result.ok) return { ok: true };
  if (failureCode(result) === 'NAMES_REQUIRED') return { ok: false, names: true };
  return { ok: false, words: joinRefusalWords(result, t) };
}
