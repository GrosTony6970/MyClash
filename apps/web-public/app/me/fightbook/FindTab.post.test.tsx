// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FindTab } from './FindTab';

/** Marc posts an open call: "Longsword at 15:00". The API's refusals are said in a call's words. */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = '11111111-1111-4111-8111-111111111111';
const POST_KEY = `POST /api/v1/me/fightbook/events/${EVENT}/calls`;
type Answer = { ok: boolean; data?: unknown; kind?: string; status?: number; code?: string };

let container: HTMLDivElement;
let root: Root;
let sent: string[];
let body: unknown;
let postAnswer: Answer;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  sent = [];
  body = undefined;
  postAnswer = { ok: true, data: { id: 'c1' } };
  const all: Record<string, () => Answer> = {
    'GET /api/v1/me/fightbook/events': () => ({
      ok: true,
      data: [
        {
          id: EVENT,
          name: 'Probe Open',
          days: ['2026-11-13'],
          today: '2026-11-13',
          freeUntil: null,
        },
      ],
    }),
    'GET /api/v1/weapons?active=true': () => ({
      ok: true,
      data: [
        { id: 'w1', name: 'Longsword' },
        { id: 'w2', name: 'Sabre' },
      ],
    }),
    [`GET /api/v1/me/fightbook/events/${EVENT}/find`]: () => ({ ok: true, data: [] }),
    'GET /api/v1/me/fightbook/find?page=0': () => ({ ok: true, data: { items: [], more: false } }),
    [`GET /api/v1/me/fightbook/events/${EVENT}/calls`]: () => ({
      ok: true,
      data: { mine: [], others: [] },
    }),
    [POST_KEY]: () => postAnswer,
  };
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    sent.push(key);
    if (key === POST_KEY) body = init?.body;
    const route = all[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return route() as never;
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
});

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const postButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Post call');
async function fill(time: string) {
  await act(async () => {
    const box = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (c) => c.parentElement?.textContent === 'Longsword',
    );
    box?.click();
    const input = container.querySelector<HTMLInputElement>('input[type="time"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, time);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FindTab apiUrl="http://api.test" onSent={vi.fn()} />
      </I18nProvider>,
    ),
  );
  await settled();
}
async function post() {
  await act(async () => postButton()?.click());
  await settled();
}

describe('Posting an open call', () => {
  it('waits for a weapon and a time before it offers the button', async () => {
    await open();
    expect(postButton()?.disabled).toBe(true);
    await fill('15:00');
    expect(postButton()?.disabled).toBe(false);
  });

  it('posts the weapons by name and the time as HH:MM, then reads the calls again', async () => {
    await open();
    await fill('15:00');
    await post();
    expect(body).toEqual({ weapons: ['Longsword'], time: '15:00' });
    expect(sent.filter((k) => k.endsWith('/calls') && k.startsWith('GET'))).toHaveLength(2);
    expect(container.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe('');
  });

  it('says bad_time in a sentence and keeps the form', async () => {
    postAnswer = { ok: false, kind: 'http', status: 400, code: 'bad_time' };
    await open();
    await fill('01:00');
    await post();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Choose a time later today, before the Event day ends.',
    );
    expect(container.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe('01:00');
  });

  it('says too_many_calls in a sentence', async () => {
    postAnswer = { ok: false, kind: 'http', status: 400, code: 'too_many_calls' };
    await open();
    await fill('15:00');
    await post();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'You have the most open calls you can have today. Close one to post another.',
    );
  });
});
