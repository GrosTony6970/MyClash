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
 * "Report a safety problem" on Julie's card with Marc. The spar day is 2026-05-23 (markFrom is its
 * midnight). The page offers the link from then on, in every status; the API judges again.
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
const LINK = 'Report a safety problem';

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
  markUntil: '2026-05-26T04:00:00.000Z',
  cancelUntil: '2026-05-24T04:00:00.000Z',
  myReview: null,
  theirThanks: null,
  note: null,
  partnerFavourite: null,
  iFlagged: false,
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
  onFlagged: vi.fn(),
  onStale: vi.fn(),
} satisfies AfterHandlers & Record<string, unknown>;

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

async function show(card: AgreedSpar, clock: string) {
  vi.setSystemTime(new Date(clock));
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
const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const box = () => container.querySelector<HTMLTextAreaElement>('textarea')!;
async function type(field: Element, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const FLAG_PATH = ['/api', 'v1', 'me/fightbook/requests/s-1/flag'].join('/');
const flagCalls = () => vi.mocked(apiRequest).mock.calls.filter(([, p]) => p === FLAG_PATH);

async function fill(reasonIndex: number, words: string) {
  await click(LINK);
  await act(async () => radios()[reasonIndex]!.click());
  await type(box(), words);
}

describe('the safety link', () => {
  it('is not there before the spar day', async () => {
    await show(spar(), BEFORE);
    expect(button(LINK)).toBeUndefined();
  });

  it.each(['agreed', 'done', 'cancelled'] as const)('is there on a %s spar', async (status) => {
    await show(spar({ status }), SPAR_DAY);
    expect(button(LINK)).toBeDefined();
  });

  it('is replaced by the line alone on a spar already flagged', async () => {
    await show(spar({ iFlagged: true }), SPAR_DAY);
    expect(button(LINK)).toBeUndefined();
    expect(text()).toContain('You flagged this spar — the MyClash team has it.');
    expect(radios()).toHaveLength(0);
  });
});

describe('the form', () => {
  it('shows four reasons, a 1000-character box and who reads it (free spar)', async () => {
    await show(spar(), SPAR_DAY);
    await click(LINK);
    expect(radios()).toHaveLength(4);
    expect(box().maxLength).toBe(1000);
    for (const label of [
      'Too hard / unsafe',
      'Unsafe equipment',
      'Disrespectful or harassing',
      'Other',
    ]) {
      expect(text()).toContain(label);
    }
    expect(text()).toContain(
      'Your name goes with this report. The MyClash team will read it. Marc Probe never sees it.',
    );
  });

  it('names the Event’s organisers on an Event spar', async () => {
    await show(spar({ kind: 'event', eventName: 'Open', place: null }), SPAR_DAY);
    await click(LINK);
    expect(text()).toContain(
      'Your name goes with this report. The Event’s organisers and the MyClash team will read it. Marc Probe never sees it.',
    );
  });

  it('keeps Send off until a reason is picked and the words are not blank', async () => {
    await show(spar(), SPAR_DAY);
    await click(LINK);
    expect(button('Send report')!.disabled).toBe(true);
    // Words with no reason picked: still off.
    await type(box(), 'Blade was bent');
    expect(button('Send report')!.disabled).toBe(true);
    await type(box(), '');
    await act(async () => radios()[1]!.click());
    expect(button('Send report')!.disabled).toBe(true);
    await type(box(), '   ');
    expect(button('Send report')!.disabled).toBe(true);
    await type(box(), 'Blade was bent');
    expect(button('Send report')!.disabled).toBe(false);
  });

  it('posts the reason and the trimmed words, then says who has it and drops the form', async () => {
    await show(spar(), SPAR_DAY);
    await fill(1, '  Blade was bent  ');
    await click('Send report');
    expect(flagCalls()).toHaveLength(1);
    expect(flagCalls()[0]![2]).toMatchObject({
      method: 'POST',
      body: { reason: 'equipment', text: 'Blade was bent' },
    });
    expect(handlers.onFlagged).toHaveBeenCalledWith('s-1');
  });

  it('once the page patches iFlagged the line replaces the form (Event spar)', async () => {
    const event = { kind: 'event', eventName: 'Open', place: null } as const;
    await show(spar(event), SPAR_DAY);
    await fill(3, 'Harassing talk');
    await click('Send report');
    await show(spar({ ...event, iFlagged: true }), SPAR_DAY);
    expect(text()).toContain('You flagged this spar — the Event’s organisers have it.');
    expect(container.querySelector('textarea')).toBeNull();
    expect(button(LINK)).toBeUndefined();
  });

  it('on 409 says the refusal and keeps the form', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 409,
      code: 'not_open',
    } as never);
    await show(spar(), SPAR_DAY);
    await fill(0, 'Too rough');
    await click('Send report');
    expect(handlers.onFlagged).not.toHaveBeenCalled();
    expect(handlers.onStale).toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(box().value).toBe('Too rough');
  });

  it('disables every button while the write runs', async () => {
    let finish: (v: unknown) => void = () => undefined;
    vi.mocked(apiRequest).mockReturnValue(new Promise((r) => (finish = r)) as never);
    await show(spar(), SPAR_DAY);
    await fill(2, 'Went on after stop');
    await act(async () => void button('Send report')!.click());
    expect(button('Send report')!.disabled).toBe(true);
    expect(button('Cancel')!.disabled).toBe(true);
    await act(async () => finish({ ok: true, data: undefined }));
    expect(flagCalls()).toHaveLength(1);
  });
});
