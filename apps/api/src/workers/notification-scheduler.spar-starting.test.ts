import { describe, expect, it, vi } from 'vitest';
import { NotificationSchedulerService } from './notification-scheduler.worker';

function service() {
  const queue = {
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
  };
  const scheduler = new NotificationSchedulerService(queue as never, { service: {} } as never);
  return { scheduler, queue };
}

const base = {
  entityId: 'e-1',
  userId: 'u-1',
  startsAt: '2026-11-14T14:00:00.000Z',
  leadMinutes: 10,
  title: 'A title',
  body: 'A body',
  url: '/somewhere',
  now: new Date('2026-11-14T10:00:00.000Z'),
};

describe('the queued job data', () => {
  it('carries the switch a reminder names, and no email', async () => {
    const { scheduler, queue } = service();
    await scheduler.scheduleReminder({
      ...base,
      kind: 'spar_starting',
      preference: 'fightbook',
    });
    const data = queue.add.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data).toMatchObject({ kind: 'spar_starting', preference: 'fightbook' });
    expect(data).not.toHaveProperty('email');
  });

  it('has no preference key at all for a reminder that names none', async () => {
    const { scheduler, queue } = service();
    await scheduler.scheduleReminder({ ...base, kind: 'match_starting' });
    const data = queue.add.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      ['body', 'entityId', 'kind', 'startsAt', 'title', 'url', 'userId'].sort(),
    );
  });
});
