import { Activity, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import {
  loadBootstrap,
  loadRefereeConflictInputs,
  loadScheduleAndProgramme,
} from './schedule-reads';
import { useScheduleData } from './useScheduleData';

/**
 * A realtime event arms the board's re-read, 1.5 s later (ruling 419). React may clean the board
 * up and set it up again while it stays (Strict Mode as the page wakes up, a hidden `<Activity>`
 * shown again). The cleanup dropped the pending re-read and the setup did not arm it again, so
 * the board stayed stale until the next event or the 30 s poll. Hiding and showing an
 * `<Activity>` is that cleanup and setup, on demand.
 */

vi.mock('./schedule-reads', () => ({
  loadBootstrap: vi.fn(),
  loadRefereeConflictInputs: vi.fn(),
  loadScheduleAndProgramme: vi.fn(),
}));
vi.mock('./useRefereeCrewConflicts', () => ({ useRefereeCrewConflicts: () => ({ result: null }) }));
/** The realtime hook's latest callbacks: the test plays the channel. */
const channel = vi.hoisted(() => ({ onEvent: () => {} }));
vi.mock('@/lib/supabase-browser', () => ({
  useRealtimeWithFallback: (opts: { onEvent: () => void }) => {
    channel.onEvent = opts.onEvent;
  },
}));

const BOOTSTRAP_OK = {
  ok: true,
  data: { lices: [], matches: [], timezone: 'Europe/Paris', days: [], programmeBlocks: [] },
};
const DEBOUNCE_MS = 1500;

function Probe() {
  useScheduleData({ eventId: 'ev1', apiUrl: 'http://api.test', isBusy: () => false });
  return null;
}

let root: Root;

function render(mode: 'visible' | 'hidden') {
  act(() =>
    root.render(
      <I18nProvider locale="en">
        <Activity mode={mode}>
          <Probe />
        </Activity>
      </I18nProvider>,
    ),
  );
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const rereads = () => vi.mocked(loadScheduleAndProgramme).mock.calls.length;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.mocked(loadBootstrap)
    .mockReset()
    .mockResolvedValue(BOOTSTRAP_OK as never);
  vi.mocked(loadScheduleAndProgramme)
    .mockReset()
    .mockResolvedValue({ ok: true, matches: [], programmeBlocks: [] } as never);
  vi.mocked(loadRefereeConflictInputs).mockResolvedValue({
    ok: false,
    failure: { kind: 'aborted' },
  } as never);
  root = createRoot(document.createElement('div'));
  render('visible');
  await wait(0);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('the board cleaned up and set up again while a re-read is pending (419)', () => {
  it('still re-reads the board', async () => {
    act(() => channel.onEvent());
    await wait(DEBOUNCE_MS / 2);
    render('hidden');
    render('visible');
    await wait(DEBOUNCE_MS);
    expect(rereads()).toBe(1);
  });

  it('does not re-read while it is hidden', async () => {
    act(() => channel.onEvent());
    render('hidden');
    await wait(DEBOUNCE_MS * 2);
    expect(rereads()).toBe(0);
  });

  it('arms nothing when no re-read was pending', async () => {
    render('hidden');
    render('visible');
    await wait(DEBOUNCE_MS * 2);
    expect(rereads()).toBe(0);
  });

  it('does not re-read after the board is gone', async () => {
    act(() => channel.onEvent());
    act(() => root.unmount());
    await wait(DEBOUNCE_MS * 2);
    expect(rereads()).toBe(0);
    // afterEach unmounts again: give it a root to unmount.
    root = createRoot(document.createElement('div'));
  });
});
