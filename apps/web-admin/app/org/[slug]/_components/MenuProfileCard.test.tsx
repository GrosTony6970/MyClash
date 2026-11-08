import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import {
  OrganizerEventContextProvider,
  useOrganizerSelectedEvent,
} from '@/components/organizer-event-context';
import { I18nProvider } from '@/i18n/I18nProvider';
import { MenuProfileCard } from './MenuProfileCard';

/**
 * The sidebar card saves the club's profile and re-reads the organisation, so the shell — which
 * reads the same profile from the same provider — changes at once. The stand-in server keeps the
 * stored profile: a taken save changes what the next organisation read answers.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const REFUSED = {
  ok: false as const,
  kind: 'unauthenticated' as const,
  status: 403 as const,
  detail: 'Requires owner role or higher',
  code: null,
  details: null,
};

let stored = 'everything';
let root: Root | null = null;

/** When set, the first organisation read answers only once this resolves, with what it read then. */
let holdFirstRead: Promise<void> | null = null;

function standInServer(takesSave: boolean) {
  let orgReads = 0;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    if (init?.method === 'PATCH' && path === '/api/v1/organizations/org-1') {
      if (!takesSave) return REFUSED as never;
      stored = (init.body as { menuProfile: string }).menuProfile;
      return { ok: true, data: {} } as never;
    }
    throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).replace('http://api.test', '');
      if (path === '/api/v1/organizations/slug/club') {
        const body = JSON.stringify({ id: 'org-1', name: 'Club', menu_profile: stored });
        if (orgReads++ === 0 && holdFirstRead) await holdFirstRead;
        return new Response(body);
      }
      if (path === '/api/v1/organizations/org-1/events') return new Response('[]');
      throw new Error(`unexpected request ${path}`);
    }),
  );
}

/** What the shell reads: the provider's profile, shown beside the card. */
function ShellProfile() {
  return <output data-testid="shell">{useOrganizerSelectedEvent().menuProfile}</output>;
}

async function open(takesSave = true) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  standInServer(takesSave);
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en">
        <OrganizerEventContextProvider slug="club" urlEventId="">
          <MenuProfileCard orgId="org-1" />
          <ShellProfile />
        </OrganizerEventContextProvider>
      </I18nProvider>,
    );
  });
}

const radio = (value: string) =>
  document.body.querySelector<HTMLInputElement>(`input[name="menu-profile"][value="${value}"]`)!;
const shell = () => document.body.querySelector('[data-testid="shell"]')?.textContent;
const choose = async (value: string) => {
  await act(async () => radio(value).click());
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  stored = 'everything';
  holdFirstRead = null;
  vi.unstubAllGlobals();
});

describe('the sidebar card on the organisation overview', () => {
  it('shows the stored profile', async () => {
    stored = 'workshops';
    await open();
    expect(radio('workshops').checked).toBe(true);
    expect(radio('everything').checked).toBe(false);
  });

  it('saves menuProfile, re-reads the organisation, and the shell follows', async () => {
    await open();
    expect(shell()).toBe('everything');
    await choose('workshops');
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'http://api.test',
      '/api/v1/organizations/org-1',
      { method: 'PATCH', body: { menuProfile: 'workshops' } },
    );
    expect(shell()).toBe('workshops');
    expect(radio('workshops').checked).toBe(true);
  });

  it('keeps the save when the first read, sent before it, lands after it', async () => {
    let release!: () => void;
    holdFirstRead = new Promise((resolve) => (release = resolve));
    await open();
    await choose('workshops');
    expect(shell()).toBe('workshops');
    await act(async () => release());
    expect(shell()).toBe('workshops');
    expect(radio('workshops').checked).toBe(true);
  });

  it('keeps the stored choice and says why when the server refuses', async () => {
    await open(false);
    await choose('workshops');
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      'Requires owner role or higher',
    );
    expect(radio('everything').checked).toBe(true);
    expect(shell()).toBe('everything');
  });
});
