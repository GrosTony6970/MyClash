import { describe, expect, it, vi } from 'vitest';
import { MatchAlertRefresherService } from './match-alert-refresher.service';

function makeRefresher() {
  const personal = { scheduleMatchStartingMany: vi.fn().mockResolvedValue(undefined) };
  const follows = { scheduleMatchStartingMany: vi.fn().mockResolvedValue(undefined) };
  const refresher = new MatchAlertRefresherService(personal as never, follows as never);
  return { refresher, personal, follows };
}

const sizes = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls.map(([ids]) => (ids as string[]).length);

describe('MatchAlertRefresherService.refresh', () => {
  it('hands both families every bout, 200 at a time, each bout once', async () => {
    // A day cleared from the board names every bout of it; each family reads
    // its bouts by id in the URL, and a failed read there is swallowed — the
    // cleared bouts' alerts would stay queued with nothing said.
    const { refresher, personal, follows } = makeRefresher();
    const ids = Array.from({ length: 401 }, (_, n) => `m-${n}`);

    await refresher.refresh([...ids, 'm-7', '']);

    expect(sizes(personal.scheduleMatchStartingMany)).toEqual([200, 200, 1]);
    expect(sizes(follows.scheduleMatchStartingMany)).toEqual([200, 200, 1]);
    expect(personal.scheduleMatchStartingMany.mock.calls.flatMap(([chunk]) => chunk)).toEqual(ids);
    expect(follows.scheduleMatchStartingMany.mock.calls.flatMap(([chunk]) => chunk)).toEqual(ids);
  });

  it('asks nothing when no bout is named', async () => {
    const { refresher, personal, follows } = makeRefresher();

    await refresher.refresh(['', '']);

    expect(personal.scheduleMatchStartingMany).not.toHaveBeenCalled();
    expect(follows.scheduleMatchStartingMany).not.toHaveBeenCalled();
  });
});
