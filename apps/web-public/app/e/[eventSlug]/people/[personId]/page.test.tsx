// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, fetchMe } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { en } from '@myclash/i18n';
import { ToastProvider } from '@myclash/ui';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../src/i18n/I18nProvider';
import PersonProfilePage from './page';

/**
 * Julie opens Marc's page at an Event. "Ask to spar" shows only when /me answered `claimed` and the
 * API says Marc may be asked. The page's own viewer type starts as 'claimed' and stays so when /me
 * fails: the button never reads it.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ eventSlug: 'open-2027', personId: MARC }),
  usePathname: () => `/e/open-2027/people/${MARC}`,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../../_components/EventHeader', () => ({
  fetchEventInfo: async () => ({ kind: 'found', event: { id: EVENT } }),
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
  fetchMe: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = '5d0c1f0e-3f7b-4a39-9a4e-2b8e9c7d1a10';
const MARC = '7f3b2c10-1d4e-4c8a-9b6f-0a1e2d3c4b5a';
const MARC_GLOBAL = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const PEOPLE = `/api/v1/events/${EVENT}/people/${MARC}`;
const ASKABLE = `/api/v1/me/fightbook/events/${EVENT}/askable?persons=${MARC}`;

const profile = (allowBeingFollowed: boolean) => ({
  id: MARC,
  givenName: 'Marc',
  familyName: 'Probe',
  clubLabel: null,
  roles: [],
  allowBeingFollowed,
  followState: 'not_following',
  hasAccount: true,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  vi.mocked(fetchMe).mockReset();
});

/** The profile and schedule read as usual; the `askable` read says Marc may be asked. */
function api(allowBeingFollowed = true) {
  vi.mocked(apiRequest).mockImplementation(async (_api, path) => {
    if (path === PEOPLE) return { ok: true, data: profile(allowBeingFollowed) } as never;
    if (path === `${PEOPLE}/schedule`) return { ok: true, data: { matches: [] } } as never;
    if (path === ASKABLE) return { ok: true, data: { [MARC]: MARC_GLOBAL } } as never;
    return { ok: false, kind: 'network' } as never;
  });
}

const signedAs = (type: 'claimed' | 'guest' | 'anonymous') =>
  vi.mocked(fetchMe).mockResolvedValue({ ok: true, data: { type } } as never);

async function show() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <PersonProfilePage />
        </ToastProvider>
      </I18nProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const askableReads = () =>
  vi.mocked(apiRequest).mock.calls.filter(([, path]) => path.includes('/askable'));
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);

describe('"Ask to spar" on an Event person page', () => {
  it('reads askable once for a signed-in fighter, and draws the button beside Follow', async () => {
    api();
    signedAs('claimed');
    await show();
    expect(askableReads().map(([, path]) => path)).toEqual([ASKABLE]);
    const ask = button('Ask to spar');
    expect(ask).toBeDefined();
    expect(ask?.parentElement).toBe(button('Follow')?.parentElement);
  });

  it('lets the buttons wrap and the name shrink, so a long name fits a phone', async () => {
    api();
    signedAs('claimed');
    await show();
    // A box that may not shrink takes its full width and never wraps its buttons.
    const buttons = button('Follow')?.parentElement?.className.split(' ');
    expect(buttons).toContain('flex-wrap');
    expect(buttons).not.toContain('flex-shrink-0');
    expect(container.querySelector('h1')?.parentElement?.className.split(' ')).toContain('min-w-0');
  });

  it('draws the button under the sentence when Marc prefers not to be followed', async () => {
    api(false);
    signedAs('claimed');
    await show();
    const ask = button('Ask to spar');
    expect(button('Follow')).toBeUndefined();
    expect(ask?.parentElement?.firstElementChild?.textContent).toBe(
      en.publicApp.following.prefersNotFollowed,
    );
  });

  it.each(['anonymous', 'guest'] as const)('reads nothing when /me answers %s', async (type) => {
    api();
    signedAs(type);
    await show();
    expect(container.textContent).toContain('Marc Probe');
    expect(askableReads()).toHaveLength(0);
    expect(button('Ask to spar')).toBeUndefined();
  });

  it('reads nothing while /me has not answered', async () => {
    api();
    vi.mocked(fetchMe).mockReturnValue(new Promise(() => undefined) as never);
    await show();
    expect(askableReads()).toHaveLength(0);
  });

  it('reads nothing and draws nothing when /me fails, though the page still shows', async () => {
    api();
    vi.mocked(fetchMe).mockResolvedValue({ ok: false, kind: 'network' } as never);
    await show();
    expect(container.textContent).toContain('Marc Probe');
    expect(askableReads()).toHaveLength(0);
    expect(button('Ask to spar')).toBeUndefined();
  });

  it('draws nothing when the API says Marc may not be asked', async () => {
    api();
    signedAs('claimed');
    const answer = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
      path === ASKABLE ? ({ ok: true, data: {} } as never) : answer?.(base, path, init),
    );
    await show();
    expect(askableReads()).toHaveLength(1);
    expect(button('Ask to spar')).toBeUndefined();
  });
});
