/**
 * One read of the guest schedule, and what its answer means.
 *
 * Only a 401 is "signed out": the server knows nobody on this device. Any other
 * answer that is not the schedule is a failed read, and so is no answer at all.
 * The page offers Retry for it. It used to say "Sign in to see your schedule"
 * for both, so a fighter with a weak signal believed they had no schedule.
 */
export type ScheduleRead<T> =
  | { kind: 'data'; data: T }
  | { kind: 'signedOut' }
  | { kind: 'failed' }
  /** The page left before the answer. */
  | { kind: 'aborted' };

export async function readMySchedule<T>(
  url: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ScheduleRead<T>> {
  try {
    const res = await fetchImpl(url, { credentials: 'include', signal });
    if (res.status === 401) return { kind: 'signedOut' };
    if (!res.ok) return { kind: 'failed' };
    return { kind: 'data', data: (await res.json()) as T };
  } catch {
    return { kind: signal.aborted ? 'aborted' : 'failed' };
  }
}
