import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeWithFallback } from './supabase-browser';

/**
 * When the organiser's live screens re-read from the server (ruling 110a).
 *
 * The channel is anonymous. RLS keeps a draft Event's rows, and an unpublished
 * Tournament's, off it, so it says SUBSCRIBED and then never speaks. The poll
 * used to stop on SUBSCRIBED, which froze the schedule board, the Pools tabs,
 * the bracket and the final ranking on exactly those Events. It now runs for
 * as long as the page is open.
 */

const channelState = vi.hoisted(() => ({
  status: null as ((status: string) => void) | null,
  opened: 0,
  removed: 0,
}));
const flagState = vi.hoisted(() => ({ realtimeDisabled: false }));

vi.mock('@supabase/supabase-js', () => {
  const channel = {
    on: () => channel,
    subscribe: (callback: (status: string) => void) => {
      channelState.status = callback;
      return channel;
    },
  };
  return {
    createClient: () => ({
      channel: () => {
        channelState.opened += 1;
        return channel;
      },
      removeChannel: async () => {
        channelState.removed += 1;
      },
    }),
  };
});
vi.mock('@myclash/ui', () => ({
  useRuntimeFlags: () => ({ realtimeDisabled: flagState.realtimeDisabled }),
  getRuntimeFlagsCached: () => ({}),
}));
vi.mock('./api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));

const poll = vi.fn();

function Probe({ pollMs }: { pollMs?: number }) {
  useRealtimeWithFallback({
    channelName: 'schedule-ev1',
    table: 'matches',
    filter: 'lice_id=in.(l1)',
    onEvent: () => {},
    onFallbackPoll: poll,
    ...(pollMs === undefined ? {} : { fallbackPollMs: pollMs }),
  });
  return null;
}

let root: Root;

function mount(pollMs?: number) {
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe pollMs={pollMs} />));
}

function report(status: string) {
  act(() => {
    channelState.status?.(status);
  });
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  poll.mockReset();
  channelState.status = null;
  channelState.opened = 0;
  channelState.removed = 0;
  flagState.realtimeDisabled = false;
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('useRealtimeWithFallback', () => {
  it('keeps re-reading every 30 s while the channel says SUBSCRIBED', () => {
    mount();
    report('SUBSCRIBED');
    expect(poll).not.toHaveBeenCalled();

    wait(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    wait(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('re-reads at the page’s own interval before the channel answers at all', () => {
    mount(7_000);

    wait(6_999);
    expect(poll).not.toHaveBeenCalled();
    wait(1);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('re-reads straight away when the channel drops, once per outage', () => {
    mount();
    report('SUBSCRIBED');

    report('CHANNEL_ERROR');
    expect(poll).toHaveBeenCalledTimes(1);
    // supabase-js retries and reports every failed attempt.
    report('TIMED_OUT');
    expect(poll).toHaveBeenCalledTimes(1);

    report('SUBSCRIBED');
    report('CLOSED');
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('keeps the interval through an outage and after the channel comes back', () => {
    mount();
    report('CHANNEL_ERROR');
    expect(poll).toHaveBeenCalledTimes(1);

    report('SUBSCRIBED');
    wait(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('with the kill switch on, opens no channel and re-reads at once, then every interval', () => {
    flagState.realtimeDisabled = true;
    mount();

    expect(channelState.opened).toBe(0);
    expect(poll).toHaveBeenCalledTimes(1);
    wait(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('stops re-reading and removes the channel when the page closes', () => {
    mount();
    report('SUBSCRIBED');
    expect(channelState.opened).toBe(1);

    act(() => root.unmount());
    // realtime-js reports CLOSED to the callback when the channel is left.
    report('CLOSED');
    wait(90_000);

    expect(poll).not.toHaveBeenCalled();
    expect(channelState.removed).toBe(1);
    // afterEach unmounts again; a second unmount of the same root is a no-op.
  });
});
