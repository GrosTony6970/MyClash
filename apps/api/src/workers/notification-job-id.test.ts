/**
 * Regression guard: every custom BullMQ job id we build must actually be
 * accepted by BullMQ.
 *
 * The ids used to be colon-separated (`notification:<kind>:<entity>:<user>`).
 * BullMQ's `Job.validateOptions` rejects any custom id containing ':' unless it
 * splits into exactly 3 parts, so `queue.add` threw on EVERY enqueue — which
 * surfaced as a 500 on the instructor "Notify participants" request. The unit
 * tests never caught it because they all mock the queue.
 *
 * So this test does not re-state the rule: it runs BullMQ's own validator over
 * the real builders. If BullMQ changes the rule, this fails here instead of in
 * production.
 */

import { Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import {
  buildFollowNotificationJobId,
  buildFollowRefereeJobId,
  buildFollowWorkshopJobId,
} from './follow-notification-scheduler.worker';
import { buildNotificationJobId, type NotificationKind } from './notification-scheduler.worker';

/** Runs BullMQ's real option validation for a custom job id. Throws when invalid. */
function validateWithBullmq(jobId: string): void {
  const job = Object.create(Job.prototype) as {
    opts: Record<string, unknown>;
    validateOptions: (jobData: { data: string; opts: Record<string, unknown> }) => void;
  };
  job.opts = { jobId };
  expect(typeof job.validateOptions).toBe('function');
  job.validateOptions({ data: '{}', opts: {} });
}

const ENTITY = '2f1c9d0e-6a3b-4c8e-9a2d-8f7b1c4e5a60';
const USER = 'a7c3b921-4f0e-4d6a-8b15-c2d9e0f3a4b7';

const KINDS: NotificationKind[] = [
  'match_starting',
  'workshop_starting',
  'referee_starting',
  'assignment_changed',
  'workshop_cancelled',
  'waitlist_promoted',
  'results_published',
  'exchange_edit_rejected',
  'organizer_broadcast',
  'follow_match_starting',
  'follow_referee_starting',
  'follow_workshop_starting',
];

describe('BullMQ job ids', () => {
  it.each(KINDS)('accepts the scheduler job id for kind %s', (kind) => {
    expect(() => validateWithBullmq(buildNotificationJobId(kind, ENTITY, USER))).not.toThrow();
  });

  it('accepts every follow-notification job id', () => {
    expect(() => validateWithBullmq(buildFollowNotificationJobId(ENTITY, USER))).not.toThrow();
    expect(() => validateWithBullmq(buildFollowRefereeJobId(ENTITY, USER))).not.toThrow();
    expect(() => validateWithBullmq(buildFollowWorkshopJobId(ENTITY, USER))).not.toThrow();
  });

  it('still keeps ids unique per (kind, entity, user)', () => {
    const ids = new Set([
      buildNotificationJobId('match_starting', ENTITY, USER),
      buildNotificationJobId('workshop_starting', ENTITY, USER),
      buildNotificationJobId('match_starting', ENTITY, 'other-user'),
      buildFollowNotificationJobId(ENTITY, USER),
      buildFollowRefereeJobId(ENTITY, USER),
      buildFollowWorkshopJobId(ENTITY, USER),
    ]);
    expect(ids.size).toBe(6);
  });

  it('proves the guard bites — the old colon format is rejected', () => {
    expect(() => validateWithBullmq(`notification:match_starting:${ENTITY}:${USER}`)).toThrow(
      /Custom Id cannot contain/,
    );
  });
});
