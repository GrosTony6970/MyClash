/**
 * The Event archive carries Workshop bookings, never who was in the room (operator ruling 549).
 *
 * A check-in (0259) says where a person physically was and when, like the desk's arrivals, which
 * the archive leaves out whole. An archive is a file that gets copied and mailed, so the two
 * check-in columns are taken off at collection (`TableSpec.personal`): the file never holds them.
 * The Workshop's auto check-in switch is a setting, and goes in.
 */
import { describe, expect, it } from 'vitest';
import { makeService } from './archive.fixtures';

const rows = () => ({
  events: [
    { id: 'event-1', organization_id: 'org-1', slug: 'fal', name: 'FAL', status: 'completed' },
  ],
  workshops: [{ id: 'w-1', event_id: 'event-1', title: 'Longsword basics', auto_check_in: true }],
  workshop_sessions: [{ id: 's-1', workshop_id: 'w-1', starts_at: '2026-11-14T09:00:00Z' }],
  workshop_enrollments: [
    {
      id: 'b-1',
      workshop_session_id: 's-1',
      user_id: 'p-lea',
      status: 'confirmed',
      checked_in_at: '2026-11-14T08:12:00Z',
      check_in_source: 'desk',
    },
  ],
});

describe('the Event archive and Workshop check-ins (549)', () => {
  it('keeps the booking and drops when the person was ticked, and by whom', async () => {
    const { service } = makeService(rows());
    const archive = await service.generateEventArchive('event-1', 'user-1', { include: 'scoring' });

    const booking = archive.data.workshopEnrollments?.[0];
    expect(booking).toMatchObject({ id: 'b-1', user_id: 'p-lea', status: 'confirmed' });
    expect(booking).not.toHaveProperty('checked_in_at');
    expect(booking).not.toHaveProperty('check_in_source');
  });

  it('keeps the Workshop’s auto check-in switch: a setting, not a person’s day', async () => {
    const { service } = makeService(rows());
    const archive = await service.generateEventArchive('event-1', 'user-1', { include: 'scoring' });

    expect(archive.data.workshops?.[0]).toMatchObject({ id: 'w-1', auto_check_in: true });
  });
});
