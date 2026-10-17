import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeFlagsCached, refreshRuntimeFlags, toRuntimeFlags } from './useRuntimeFlags';

const snapshot = {
  maintenanceBanner: { enabled: false, message: null, severity: null },
  realtimeDisabled: false,
  timeSimulation: {
    enabled: true,
    simulatedNowIso: '2027-05-22T08:00:00.000Z',
    anchorRealIso: '2026-07-13T12:00:00.000Z',
  },
  serverNowIso: '2026-07-13T12:10:00.000Z',
};

describe('toRuntimeFlags', () => {
  it("keeps this browser's distance from the server clock, not the server's reading", () => {
    // The browser runs 2 min slow: it sent at 12:07:59.5 and heard back at 12:08:00.5.
    const browserMs = Date.parse('2026-07-13T12:08:00.000Z');
    const flags = toRuntimeFlags(snapshot, browserMs - 500, browserMs + 500);

    expect(flags.clockSkewMs).toBe(2 * 60_000);
    expect(flags).not.toHaveProperty('serverNowIso');
    expect(flags.timeSimulation).toEqual(snapshot.timeSimulation);
  });
});

describe('refreshRuntimeFlags', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not hand back a poll that left before the save', async () => {
    // A poll is in flight with the old answer when the admin saves. The
    // refresh after the save must read again, not join that poll.
    const answers: Array<(body: unknown) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push((body) => resolve({ ok: true, json: async () => body }));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const apiUrl = 'http://race.test';
    const before = { ...snapshot, realtimeDisabled: false };
    const after = { ...snapshot, realtimeDisabled: true };

    const stalePoll = refreshRuntimeFlags(apiUrl);
    const afterSave = refreshRuntimeFlags(apiUrl);
    answers[0]!(before);
    await stalePoll;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    answers[1]!(after);

    expect((await afterSave)?.realtimeDisabled).toBe(true);
    expect(getRuntimeFlagsCached(apiUrl).realtimeDisabled).toBe(true);
  });
});
