// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { AgreedSpar, MySpars, SentSparRequest } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FightBookClient } from './FightBookClient';

/**
 * The race between a re-read and a write. Julie takes back her request to Paul, but Paul said yes
 * first: the page reads again. While that read is on its way she cancels her spar with Marc. The
 * read answers what the server held before the cancel: shown as it is, it would bring the cancelled
 * spar back. The page reads once more instead, and shows both changes.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=spars'),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const marc = {
  globalPersonId: '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01',
  name: 'Marc Probe',
  photoUrl: null,
  club: null,
};
const paul = {
  globalPersonId: '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23',
  name: 'Paul Probe',
  photoUrl: null,
  club: null,
};
const when = {
  kind: 'free' as const,
  eventName: null,
  day: '2026-05-24',
  time: null,
  place: 'Salle',
};

const spar = (id: string, over: Partial<AgreedSpar>): AgreedSpar => ({
  ...when,
  id,
  partner: marc,
  iAsked: false,
  weapons: ['Sabre'],
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
const waiting: SentSparRequest = {
  ...when,
  id: 'q-1',
  receiver: paul,
  weapons: ['Sabre'],
  message: null,
  status: 'pending',
  comment: null,
};
const withMarc = spar('s-1', {});
const withPaul = spar('q-1', { partner: paul, iAsked: true });
const cancelledByMe = spar('s-1', { status: 'cancelled', cancelledByMe: true });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-05-23T10:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
});

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const buttons = (label: string) =>
  [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);

describe('a re-read that a write overtakes', () => {
  it('is dropped, and the page reads once more', async () => {
    let release: () => void = () => {};
    const sparReads: Array<() => Promise<MySpars>> = [
      async () => ({ spars: [withMarc], sent: [waiting] }),
      () =>
        new Promise(
          (resolve) => (release = () => resolve({ spars: [withMarc, withPaul], sent: [] })),
        ),
      async () => ({ spars: [cancelledByMe, withPaul], sent: [] }),
    ];
    const routes: Record<string, () => unknown> = {
      'GET /api/v1/me/fightbook/settings': () => ({ hasProfile: true, enabled: true }),
      'GET /api/v1/me/fightbook/inbox': () => [],
      'GET /api/v1/me/fightbook/blocks': () => [],
      'GET /api/v1/me/fightbook/spars': () => sparReads.shift()!(),
      'GET /api/v1/me/fightbook/thanks?page=0': () => ({ items: [], more: false }),
    };
    vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
      const key = `${init?.method ?? 'GET'} ${path}`;
      if (key === 'POST /api/v1/me/fightbook/requests/q-1/withdraw') {
        return { ok: false, kind: 'http', status: 409, code: 'not_open' } as never;
      }
      if (key === 'POST /api/v1/me/fightbook/requests/s-1/cancel')
        return { ok: true, data: null } as never;
      const route = routes[key];
      if (!route) throw new Error(`unexpected request ${key}`);
      return { ok: true, data: await route() } as never;
    });

    await open();
    await act(async () => buttons('Take back')[0]!.click());
    await settled();
    // The re-read is on its way; Julie cancels her spar with Marc meanwhile.
    await act(async () => buttons('Cancel the spar')[0]!.click());
    await settled();
    await act(async () => buttons('Cancel the spar').at(-1)!.click());
    await settled();
    expect(container.textContent).toContain('You cancelled this spar.');
    await act(async () => release());
    await settled();
    await settled();

    expect(sparReads).toHaveLength(0);
    expect(container.textContent).toContain('You cancelled this spar.');
    expect(buttons('Take back')).toHaveLength(0);
    expect(container.textContent).toContain('You asked');
  });
});

describe('a re-read that fails', () => {
  it('keeps the page and the sentence that said why it read again', async () => {
    let first = true;
    vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
      const key = `${init?.method ?? 'GET'} ${path}`;
      if (key === 'POST /api/v1/me/fightbook/requests/q-1/withdraw') {
        return { ok: false, kind: 'http', status: 409, code: 'not_open' } as never;
      }
      if (key === 'GET /api/v1/me/fightbook/settings') {
        return { ok: true, data: { hasProfile: true, enabled: true } } as never;
      }
      if (key === 'GET /api/v1/me/fightbook/spars' && first) {
        first = false;
        return { ok: true, data: { spars: [withMarc], sent: [waiting] } } as never;
      }
      if (key === 'GET /api/v1/me/fightbook/spars') return { ok: false, kind: 'network' } as never;
      return { ok: true, data: [] } as never;
    });
    await open();
    await act(async () => buttons('Take back')[0]!.click());
    await settled();
    await settled();
    expect(first).toBe(false);
    expect(container.textContent).not.toContain('FightBook could not be loaded.');
    expect(container.textContent).toContain('Marc Probe');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'This request is no longer open.',
    );
  });
});

async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FightBookClient />
      </I18nProvider>,
    ),
  );
  await settled();
}
