import { describe, expect, it, vi } from 'vitest';
import { ScheduleGridController } from './schedule-grid.controller';

// The grid decides what a draft Tournament shows by WHO asks (ruling 129): the controller must
// hand the service the request's own login and staff session, resolved by the AuthGuard.
describe('ScheduleGridController', () => {
  it("passes the request's login and staff session to the grid", async () => {
    const listEventSchedule = vi.fn().mockResolvedValue([]);
    const controller = new ScheduleGridController({ listEventSchedule } as never);
    const staffSession = { staffId: 'staff-1', eventId: 'e1' };
    const req = { identity: { kind: 'claimed', userId: 'member', email: null }, staffSession };

    await controller.listEventSchedule('e1', req as never);

    expect(listEventSchedule).toHaveBeenCalledWith('e1', { userId: 'member', staff: staffSession });
  });

  it('passes an anonymous reader for a request with no login', async () => {
    const listEventSchedule = vi.fn().mockResolvedValue([]);
    const controller = new ScheduleGridController({ listEventSchedule } as never);

    await controller.listEventSchedule('e1', {} as never);

    expect(listEventSchedule).toHaveBeenCalledWith('e1', { userId: 'anonymous', staff: null });
  });
});
