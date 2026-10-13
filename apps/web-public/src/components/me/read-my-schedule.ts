import { fetchRenewingLogin } from '@myclash/api-client';

/**
 * One read of a person's schedule at one Event, and what its answer means.
 *
 * Only a 401 is "signed out": the server knows nobody on this device. Any other
 * answer that is not the schedule is a failed read, and so is no answer at all.
 * The page offers Retry for it. It used to say "Sign in to see your schedule"
 * for both, so a fighter with a weak signal believed they had no schedule.
 *
 * And a 401 is that answer only after the login was asked to renew: the login
 * cookie lasts an hour, and only `/me` renews it (`fetchRenewingLogin`, the one
 * owner of that). A fighter who opens the page after lunch holds a login that
 * is still good. Read as "signed out", it took her schedule off the phone.
 */
export type ScheduleRead<T> =
  | { kind: 'data'; data: T }
  | { kind: 'signedOut' }
  | { kind: 'failed' }
  /** The page left before the answer. */
  | { kind: 'aborted' };

export async function readMySchedule<T>(
  apiUrl: string,
  eventKey: string,
  signal: AbortSignal,
): Promise<ScheduleRead<T>> {
  try {
    const res = await fetchRenewingLogin(apiUrl, `/api/v1/events/${eventKey}/my-schedule`, {
      credentials: 'include',
      signal,
    });
    if (res.status === 401) return { kind: 'signedOut' };
    if (!res.ok) return { kind: 'failed' };
    return { kind: 'data', data: (await res.json()) as T };
  } catch {
    return { kind: signal.aborted ? 'aborted' : 'failed' };
  }
}
