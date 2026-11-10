import { apiRequest, failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';

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
  return failureMessage(failure, t, t('publicApp.workshopDetail.join.failed')) ?? '';
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
