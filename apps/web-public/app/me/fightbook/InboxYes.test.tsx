// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { AgreedSpar, IncomingSparRequest } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FightBookClient } from './FightBookClient';

/**
 * Julie says Yes to Marc in the Inbox. The card lands in My spars at once with the request's
 * windows (the list patch, tested in fightbook-patches.test.ts), then the page reads again, so
 * what only the server knows (the heart) arrives.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => search,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const marc = {
  globalPersonId: '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01',
  name: 'Marc Probe',
  photoUrl: null,
  club: null,
};
const request: IncomingSparRequest = {
  id: 'r-1',
  asker: marc,
  kind: 'free',
  eventName: null,
  day: '2026-05-23',
  time: null,
  place: 'Salle',
  weapons: ['Sabre'],
  message: null,
  markFrom: '2026-05-22T22:00:00.000Z',
  markUntil: '2026-05-26T04:00:00.000Z',
  cancelUntil: '2026-05-24T04:00:00.000Z',
};
const agreed: AgreedSpar = {
  ...request,
  partner: marc,
  iAsked: false,
  status: 'agreed',
  cancelledByMe: null,
  cancelMessage: null,
  myReview: null,
  theirThanks: null,
  note: null,
  partnerFavourite: true,
  iFlagged: false,
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  search = new URLSearchParams();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-05-23T10:00:00Z') });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.mocked(apiRequest).mockReset();
});

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const reads = (path: string) =>
  vi.mocked(apiRequest).mock.calls.filter(([, p, init]) => p === path && !init?.method).length;
const open = async () => {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FightBookClient />
      </I18nProvider>,
    ),
  );
  await settled();
};

describe('a Yes in the Inbox', () => {
  it('lands the spar in My spars and reads the page again behind it', async () => {
    let yes = false;
    const answers: Record<string, () => unknown> = {
      'GET /api/v1/me/fightbook/settings': () => ({ hasProfile: true, enabled: true }),
      'GET /api/v1/me/fightbook/inbox': () => (yes ? [] : [request]),
      'GET /api/v1/me/fightbook/spars': () => ({ spars: yes ? [agreed] : [], sent: [] }),
      'GET /api/v1/me/fightbook/blocks': () => [],
      'GET /api/v1/me/fightbook/thanks?page=0': () => ({ items: [], more: false }),
      'POST /api/v1/me/fightbook/requests/r-1/answer': () => {
        yes = true;
        return { status: 'agreed' };
      },
    };
    vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
      const answer = answers[`${init?.method ?? 'GET'} ${path}`];
      if (!answer) throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`);
      return { ok: true, data: answer() } as never;
    });
    await open();
    expect(reads('/api/v1/me/fightbook/spars')).toBe(1);
    const yesButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Yes',
    )!;
    await act(async () => yesButton.click());
    await settled();
    await settled();
    expect(reads('/api/v1/me/fightbook/spars')).toBeGreaterThanOrEqual(2);
    search = new URLSearchParams('tab=spars');
    await open();
    expect(container.textContent).toContain('Marc Probe');
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'We sparred'),
    ).toBe(true);
  });
});
