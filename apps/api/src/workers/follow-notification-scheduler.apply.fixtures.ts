/**
 * Léa's bouts, duties and Workshops for the tests of `applyFollow` (rulings 207, 209), split out
 * when one test file reached the 400-line cap. Test-only: it imports vitest.
 */
import { vi } from 'vitest';
import { mockSupabase } from '../common/testing/supabase-chain';
import { FollowNotificationSchedulerService } from './follow-notification-scheduler.worker';

export const NOW = new Date('2026-05-02T10:00:00.000Z');
export const at = (hhmm: string) => `2026-05-02T${hhmm}:00.000Z`;

const bout = (id: string, scheduledAt: string | null, red: string, blue: string) => ({
  id,
  match_number_label: id,
  scheduled_at: scheduledAt,
  red_registration_id: `reg-${red}`,
  blue_registration_id: `reg-${blue}`,
  pool_id: null,
  lice_id: 'lice-1',
  phase_id: 'phase-1',
  planned_duration_override_minutes: null,
  lices: { name: 'Lice 1' },
  pools: { name: 'Pool A' },
});
const entry = (id: string) => ({
  id: `reg-${id}`,
  person_id: id,
  persons: { given_name: id, family_name: 'Roux' },
});
const ALL_ON = {
  notify_match_start: true,
  notify_referee_start: true,
  notify_workshop_start: true,
};
export const ALL_OFF = {
  notify_match_start: false,
  notify_referee_start: false,
  notify_workshop_start: false,
};
/** One saved follow; every switch on unless the test says otherwise. */
export const follow = (
  follower: string,
  switches: Partial<typeof ALL_ON> = {},
  person = 'lea',
) => ({
  followed_person_id: person,
  follower_user_id: follower,
  ...ALL_ON,
  ...switches,
});
const duty = (id: string, profile: string, eventId: string, status = 'confirmed') => ({
  id,
  person_id: profile,
  event_id: eventId,
  match_id: 'bout-of-zoe',
  status,
});
const session = (id: string, workshopId: string, eventId: string) => ({
  id,
  workshop_id: workshopId,
  starts_at: at('14:00'),
  status: 'scheduled',
  workshops: { id: workshopId, title: 'Longsword', event_id: eventId },
});
export const teaches = (workshopId: string, profile: string) => ({
  workshop_id: workshopId,
  global_person_id: profile,
});
export const HER_WORKSHOPS = [
  teaches('workshop-1', 'gp-lea'),
  teaches('workshop-elsewhere', 'gp-lea'),
];

/**
 * Léa's bouts: one still ahead (against Tom), one fought an hour ago, one with no time. Zoé's bout
 * is not hers. Léa referees Zoé's bout (locked), has one duty still being planned, and one in
 * another Event; Tom has a duty in this Event. Léa teaches one Workshop here and one in another
 * Event; Zoé's Workshop here is not hers. Nina follows Léa too: nothing here is about her.
 */
const TABLES = {
  registrations: { rows: ['lea', 'tom', 'zoe', 'ana'].map(entry) },
  matches: {
    rows: [
      bout('bout-ahead', at('10:30'), 'lea', 'tom'),
      bout('bout-fought', at('09:00'), 'lea', 'zoe'),
      bout('bout-untimed', null, 'lea', 'ana'),
      bout('bout-of-zoe', at('11:00'), 'zoe', 'ana'),
    ],
  },
  follows: { rows: [follow('marc'), follow('nina')] },
  // Nobody follows her from the People hub: a hub follow has its own tests.
  directory_follows: { rows: [] },
  notification_preferences: { rows: [] },
  persons: {
    rows: [
      { id: 'lea', global_person_id: 'gp-lea', event_id: 'event-1' },
      { id: 'tom', global_person_id: 'gp-tom', event_id: 'event-1' },
    ],
  },
  global_persons: {
    rows: [
      { id: 'gp-lea', display_name: 'Léa Roux' },
      { id: 'gp-tom', display_name: 'Tom Roux' },
    ],
  },
  referee_assignments: {
    rows: [
      duty('duty-1', 'gp-lea', 'event-1'),
      duty('duty-planned', 'gp-lea', 'event-1', 'assigned'),
      duty('duty-elsewhere', 'gp-lea', 'event-2'),
      duty('duty-of-tom', 'gp-tom', 'event-1'),
    ],
  },
  // Canned: the Workshop alert reads it with a filter the seeded double does not model.
  workshop_instructors: { data: HER_WORKSHOPS, error: null },
  workshops: {
    rows: [
      { id: 'workshop-1', event_id: 'event-1' },
      { id: 'workshop-elsewhere', event_id: 'event-2' },
      { id: 'workshop-of-zoe', event_id: 'event-1' },
    ],
  },
  workshop_sessions: {
    rows: [
      session('session-1', 'workshop-1', 'event-1'),
      session('session-elsewhere', 'workshop-elsewhere', 'event-2'),
      session('session-of-zoe', 'workshop-of-zoe', 'event-1'),
    ],
  },
};

export const BOOM = { data: null, error: { message: 'boom' } };

export function setup(tables: Record<string, unknown> = {}) {
  const removed: string[] = [];
  const waiting = (id: string) => ({ remove: async () => void removed.push(id) });
  const queue = {
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn(async (id: string) => waiting(id)),
  };
  const db = mockSupabase({ ...TABLES, ...tables } as Parameters<typeof mockSupabase>[0]);
  const service = new FollowNotificationSchedulerService(queue as never, db as never);
  const set = () => queue.add.mock.calls.map((call) => (call[2] as { jobId: string }).jobId).sort();
  // An alert that is set again is removed twice (once here, once by the write): count it once.
  const gone = () => [...new Set(removed)].sort();
  const bodyOf = (jobId: string) =>
    (
      queue.add.mock.calls.find((call) => (call[2] as { jobId: string }).jobId === jobId)?.[1] as
        { body: string } | undefined
    )?.body;
  return { service, queue, db, gone, set, bodyOf };
}

export const HIS_BOUT = 'follow.match_starting.bout-ahead.marc';
export const HIS_DUTY = 'follow.referee_starting.duty-1.marc';
export const HIS_SESSION = 'follow.workshop_starting.session-1.marc';
/** Every alert of his about her that is removed: what has no time or is not locked too. */
export const HIS_ALERTS = [
  HIS_BOUT,
  'follow.match_starting.bout-fought.marc',
  'follow.match_starting.bout-untimed.marc',
  HIS_DUTY,
  'follow.referee_starting.duty-planned.marc',
  HIS_SESSION,
];
