/**
 * duty-alert-rings.ts — is a referee duty's "starting soon" set? (operator ruling 221). The ONE
 * owner of that rule: the referee's own alert and his followers' both ask it, at every door (the
 * lock, a retime of the duty's bouts, a change of a follow).
 *
 * Pool 3 starts at 10:00 and Paul's phone rang at 9:50. The organiser moves the last bout of the
 * Pool at 9:55, or locks the board a second time: nothing changed for Paul, and his phone stays
 * quiet. The Pool moves to 10:20: it rings again, at 10:10. A final placed at 13:55 for 14:00
 * rings at once: nobody was told of it yet.
 *
 * The memory is the alert that fired. A duty alert that completed stays in the queue for a day
 * after its minute (`DUTY_ALERT_KEPT`), with the start it was set for and what the worker answered. One that was
 * SENT is not sent again for the same start. One the send gate DROPPED (a draft's, an unlocked
 * duty's) rang for nobody, so the next door sets it again. One that FAILED counts as sent: a
 * dead push subscription fails the job after the live phones rang. A failed job is kept by
 * COUNT, not by age: the queue holds its last 100 failures, of every kind, so that record can go
 * within the hour or outlive the day. No job at all is no memory: the alert is set.
 *
 * A duty that has started rings for nobody: a delay cannot be negative, so its alert would be
 * sent at once, as "starting soon". A second lock at midday is quiet for the morning's duties.
 *
 * Named, not closed. Move and undo: a duty moved from 10:00 to 10:20 after its alert rang has
 * its record replaced by the 10:10 alert; moved back, it rings again for 10:00. A record older
 * than a day is gone.
 */

/** What the worker answers for a job: BullMQ keeps it as the job's `returnvalue`. */
export const ALERT_SENT = 'sent';
export const ALERT_DROPPED = 'dropped';
export type AlertOutcome = typeof ALERT_SENT | typeof ALERT_DROPPED;

/** How long a duty alert that completed stays in the queue: the memory of what it rang for. */
export const DUTY_ALERT_KEPT = { age: 86_400 };

/** What the queue holds under an alert's id, as far as the rule reads it. */
export interface HeldAlert {
  /** Set once the job fired, whatever came of it. */
  finishedOn?: number;
  returnvalue?: unknown;
  data?: { startsAt?: string | null };
}

/** Some duties, named for a log line: the first, and how many more. */
export const namedDuties = (duties: ReadonlyArray<{ id: string }>): string =>
  `${duties[0]?.id}${duties.length > 1 ? ` and ${duties.length - 1} more` : ''}`;

/** Set the alert, keep what is held, or remove one that still waits. */
export type DutyAlertStep = 'set' | 'keep' | 'remove';

/** Has this job fired? One that has not still waits for its minute. */
export const hasFired = (held: HeldAlert | null | undefined): boolean => Boolean(held?.finishedOn);

/** The start an alert rang for, as an instant; null when none fired, or it was dropped. */
function rangFor(held: HeldAlert | null | undefined): number | null {
  if (!hasFired(held) || held?.returnvalue === ALERT_DROPPED) return null;
  const startsAt = held?.data?.startsAt;
  return startsAt ? new Date(startsAt).getTime() : null;
}

export function dutyAlertStep(
  startsAt: string,
  now: Date,
  held: HeldAlert | null | undefined,
): DutyAlertStep {
  const start = new Date(startsAt).getTime();
  if (start <= now.getTime()) return 'remove';
  return rangFor(held) === start ? 'keep' : 'set';
}
