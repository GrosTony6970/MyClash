// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMyEvents } from './hooks';

/**
 * "My events" read loudly (ruling 461): a failed read is said, with Try again, never read as no
 * Events; and a login over an hour old is renewed as on every other screen (`renew-login.ts`).
 */

type Answer = { status: number; body?: unknown };

let container: HTMLDivElement;
let root: Root;
let seen: ReturnType<typeof useMyEvents>;
let calls: string[];

function Probe() {
  seen = useMyEvents();
  return null;
}

/** `fetch` answering each address from its own list, in turn; the last answer repeats. */
function answering(byPath: Record<string, Answer[]>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      calls.push(path);
      const list = byPath[path] ?? [{ status: 500 }];
      const { status, body } = list.length > 1 ? list.shift()! : list[0]!;
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }),
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const EVENTS = [{ event: { id: 'ev-1', slug: 'lyon' } }];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('useMyEvents', () => {
  it('says a failed read, and Try again reads it once more', async () => {
    answering({ '/api/v1/me/events': [{ status: 500 }, { status: 200, body: EVENTS }] });
    act(() => root.render(<Probe />));
    await settle();
    expect(seen).toMatchObject({ error: true, loading: false });

    act(() => seen.retry());
    expect(seen).toMatchObject({ error: false, loading: true });
    await settle();
    expect(seen).toMatchObject({ error: false, loading: false, events: EVENTS });
  });

  it('reads a body that is not a list as a failed read', async () => {
    answering({ '/api/v1/me/events': [{ status: 200, body: {} }] });
    act(() => root.render(<Probe />));
    await settle();
    expect(seen.error).toBe(true);
  });

  it('a page that leaves aborts its read', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    act(() => root.render(<Probe />));
    await settle();
    expect(signal?.aborted).toBe(false);
    act(() => root.render(<></>));
    expect(signal?.aborted).toBe(true);
  });

  it('renews a login over an hour old, then reads her Events', async () => {
    answering({
      '/api/v1/me/events': [{ status: 401 }, { status: 200, body: EVENTS }],
      '/api/v1/me': [{ status: 200, body: { type: 'claimed' } }],
    });
    act(() => root.render(<Probe />));
    await settle();
    expect(seen).toMatchObject({ error: false, events: EVENTS });
    expect(calls).toEqual(['/api/v1/me/events', '/api/v1/me', '/api/v1/me/events']);
  });
});
