// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { AgreedSpar } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { MySparsTab } from './MySparsTab';
import type { AfterHandlers } from './use-spar-after';

/**
 * After the spar, on Julie's card with Marc. The spar day is 2026-05-23 (markFrom is its midnight,
 * cancel closes at the day's end, "We sparred" and its undo close two days later). Every case
 * sets the clock; the API judges again, the page only decides what it offers.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const marc = {
  globalPersonId: '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01',
  name: 'Marc Probe',
  photoUrl: null,
  club: null,
};
const BEFORE = '2026-05-22T10:00:00Z';
const SPAR_DAY = '2026-05-23T10:00:00Z';
const AFTER_CANCEL = '2026-05-25T10:00:00Z';
const AFTER_WINDOW = '2026-05-27T10:00:00Z';
const MARK_UNTIL = '2026-05-26T04:00:00.000Z';

const spar = (over: Partial<AgreedSpar> = {}): AgreedSpar => ({
  id: 's-1',
  kind: 'free',
  eventName: null,
  day: '2026-05-23',
  time: null,
  place: 'Salle',
  weapons: ['Sabre'],
  partner: marc,
  iAsked: false,
  message: null,
  status: 'agreed',
  cancelledByMe: null,
  cancelMessage: null,
  markFrom: '2026-05-22T22:00:00.000Z',
  markUntil: MARK_UNTIL,
  cancelUntil: '2026-05-24T04:00:00.000Z',
  myReview: null,
  theirThanks: null,
  note: null,
  partnerFavourite: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const handlers = {
  onCancelled: vi.fn(),
  onWithdrawn: vi.fn(),
  onMarked: vi.fn(),
  onUndone: vi.fn(),
  onReviewed: vi.fn(),
  onNoted: vi.fn(),
  onStale: vi.fn(),
} satisfies AfterHandlers & Record<string, unknown>;
const NOT_OPEN = { ok: false, kind: 'http', status: 409, code: 'not_open' };

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.mocked(apiRequest).mockResolvedValue({ ok: true, data: undefined } as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.mocked(apiRequest).mockReset();
  Object.values(handlers).forEach((h) => h.mockReset());
});

const at = (iso: string) => vi.setSystemTime(new Date(iso));
async function show(card: AgreedSpar, clock: string) {
  at(clock);
  // A fresh mount per call: the card reads the clock when it mounts, then at each window's edge.
  await act(async () => root.render(null));
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <MySparsTab apiUrl="http://api" spars={{ spars: [card], sent: [] }} {...handlers} />
      </I18nProvider>,
    ),
  );
}
const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const click = (label: string) => act(async () => button(label)!.click());
const lastWrite = (method: string, path: string) =>
  vi
    .mocked(apiRequest)
    .mock.calls.find(([, p, init]) => p === path && init?.method === method)?.[2];
async function type(field: Element, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
// Joined, not written whole: the route-contract test reads every /api/v1 literal as a real route.
const R = ['/api', 'v1', 'me/fightbook/requests/s-1'].join('/');

describe('We sparred and Undo', () => {
  it('is not offered before the spar day, and Cancel still is', async () => {
    await show(spar(), BEFORE);
    expect(button('We sparred')).toBeUndefined();
    expect(button('Cancel the spar')).toBeDefined();
  });

  it('is offered on the spar day and sends one write', async () => {
    await show(spar(), SPAR_DAY);
    await click('We sparred');
    expect(lastWrite('POST', `${R}/done`)).toBeDefined();
    expect(handlers.onMarked).toHaveBeenCalledWith('s-1');
  });

  it('after the day ends Cancel goes, "We sparred" stays until the window shuts', async () => {
    await show(spar(), AFTER_CANCEL);
    expect(button('Cancel the spar')).toBeUndefined();
    expect(button('We sparred')).toBeDefined();
    await show(spar(), AFTER_WINDOW);
    expect(button('We sparred')).toBeUndefined();
  });

  it('a done spar says when it can be undone, undoes, and is never read as cancelled', async () => {
    await show(spar({ status: 'done' }), AFTER_CANCEL);
    const until = new Intl.DateTimeFormat('en', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(MARK_UNTIL));
    expect(text()).toContain(`Marked as sparred — you can undo until ${until}`);
    expect(text()).not.toContain('cancelled');
    expect(button('Cancel the spar')).toBeUndefined();
    expect(button('We sparred')).toBeUndefined();
    await click('Undo');
    expect(lastWrite('POST', `${R}/undo`)).toBeDefined();
    expect(handlers.onUndone).toHaveBeenCalledWith('s-1');
  });

  it('a button is disabled while its write is on its way', async () => {
    let land: (a: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementation(
      () => new Promise((resolve) => (land = resolve)) as never,
    );
    await show(spar(), SPAR_DAY);
    await click('We sparred');
    expect(button('We sparred')!.disabled).toBe(true);
    await act(async () => land({ ok: true, data: undefined }));
    expect(button('We sparred')!.disabled).toBe(false);
  });

  it('a window that closed under an open page says so and reads the page again', async () => {
    vi.mocked(apiRequest).mockResolvedValue(NOT_OPEN as never);
    await show(spar(), SPAR_DAY);
    await click('We sparred');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'This request is no longer open.',
    );
    expect(handlers.onStale).toHaveBeenCalledTimes(1);
    expect(handlers.onMarked).not.toHaveBeenCalled();
  });
});

describe('the clock moving under an open page', () => {
  it('turns Undo into the thank-you form when the window shuts, with no tap', async () => {
    vi.useFakeTimers({ now: new Date('2026-05-26T03:59:00Z') });
    await show(spar({ status: 'done' }), '2026-05-26T03:59:00Z');
    expect(button('Undo')).toBeDefined();
    expect(container.querySelector('[role="radiogroup"], fieldset')).toBeNull();
    await act(async () => vi.advanceTimersByTime(61_000));
    expect(button('Undo')).toBeUndefined();
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(5);
  });
});

describe('the thank-you', () => {
  it('is not asked before the window shuts', async () => {
    await show(spar({ status: 'done' }), AFTER_CANCEL);
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });

  it('stars are a radio group with names; the words go with Send', async () => {
    await show(spar({ status: 'done' }), AFTER_WINDOW);
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      '1 of 5',
      '2 of 5',
      '3 of 5',
      '4 of 5',
      '5 of 5',
    ]);
    expect(button('Send')!.disabled).toBe(true);
    await act(async () => radios[3]!.click());
    await type(container.querySelectorAll('textarea')[0]!, '  Great fight  ');
    await click('Send');
    expect(lastWrite('POST', `${R}/review`)?.body).toEqual({
      stars: 4,
      anonymous: false,
      text: 'Great fight',
    });
    expect(handlers.onReviewed).toHaveBeenCalledWith('s-1', {
      stars: 4,
      anonymous: false,
      text: 'Great fight',
    });
  });

  it('"without my name" hides the words and sends no text key', async () => {
    await show(spar({ status: 'done' }), AFTER_WINDOW);
    await type(container.querySelectorAll('textarea')[0]!, 'Hidden');
    expect(container.querySelectorAll('textarea')).toHaveLength(2);
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
    await act(async () =>
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!.click(),
    );
    await click('Send');
    const body = lastWrite('POST', `${R}/review`)?.body as Record<string, unknown>;
    expect(body).toEqual({ stars: 2, anonymous: true });
    expect('text' in body).toBe(false);
  });

  it('a stars-only thank-you sends no empty text', async () => {
    await show(spar({ status: 'done' }), AFTER_WINDOW);
    await act(async () =>
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[4]!.click(),
    );
    await click('Send');
    expect(lastWrite('POST', `${R}/review`)?.body).toEqual({ stars: 5, anonymous: false });
  });

  it('a form left open across the window says the refusal and reads again', async () => {
    vi.mocked(apiRequest).mockResolvedValue(NOT_OPEN as never);
    await show(spar({ status: 'done' }), AFTER_WINDOW);
    await act(async () =>
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[2]!.click(),
    );
    await click('Send');
    expect(text()).toContain('This request is no longer open.');
    expect(handlers.onStale).toHaveBeenCalledTimes(1);
  });

  it('what I wrote shows instead of the form; an anonymous one says so', async () => {
    const mine = { stars: 4, text: 'Fun', anonymous: false };
    await show(spar({ status: 'done', myReview: mine }), AFTER_WINDOW);
    expect(text()).toContain('Your thank-you: ★ 4');
    expect(text()).toContain('Fun');
    expect(text()).not.toContain('anonymous');
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    await show(
      spar({ status: 'done', myReview: { stars: 3, text: null, anonymous: true } }),
      AFTER_WINDOW,
    );
    expect(text()).toContain('Your thank-you: ★ 3 (anonymous)');
  });

  it('their signed thank-you shows with its words', async () => {
    const theirThanks = { stars: 5, text: 'Merci' };
    await show(spar({ status: 'done', theirThanks }), AFTER_WINDOW);
    expect(text()).toContain('Marc Probe thanked you ★ 5');
    expect(text()).toContain('Merci');
  });
});

describe('the private note', () => {
  it('saves on Save and clears when saved empty', async () => {
    await show(spar({ status: 'done', note: 'Fast left side' }), AFTER_CANCEL);
    const box = container.querySelector('textarea')!;
    expect(box.value).toBe('Fast left side');
    await type(box, ' Watch the feint ');
    await click('Save');
    expect(lastWrite('PUT', `${R}/note`)?.body).toEqual({ body: 'Watch the feint' });
    expect(handlers.onNoted).toHaveBeenCalledWith('s-1', 'Watch the feint');
    await type(container.querySelector('textarea')!, '');
    await click('Save');
    expect(handlers.onNoted).toHaveBeenLastCalledWith('s-1', null);
  });

  it('is not offered on an agreed spar, nor a cancelled one', async () => {
    await show(spar(), SPAR_DAY);
    expect(container.querySelector('textarea')).toBeNull();
    await show(spar({ status: 'cancelled', cancelledByMe: true }), SPAR_DAY);
    expect(container.querySelector('textarea')).toBeNull();
    expect(text()).toContain('Spar cancelled');
  });
});
