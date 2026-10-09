/**
 * The club's Event list after a login lapsed (ruling 380).
 *
 * That list is what closes the pages of an archived Event. A login lasts an hour:
 * an organiser who comes back and reloads sends the club read with a dead login,
 * and it answers 401. The read renews the login and is sent again. Left at the
 * 401, the list stayed empty and every page of an archived Event stayed live.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import {
  OrganizerEventContextProvider,
  useOrganizerSelectedEvent,
} from './organizer-event-context';

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));

const API = 'http://api.test';
const CLUB = `${API}/api/v1/organizations/slug/club`;
const LIST = `${API}/api/v1/organizations/org-1/events`;
const ME = `${API}/api/v1/me`;
const ARCHIVED = { id: 'ev1', name: 'Open 2025', status: 'archived' };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function Probe() {
  const { events, eventsError } = useOrganizerSelectedEvent();
  return <p data-testid="probe">{`${events.map((e) => e.status).join(',')}|${eventsError}`}</p>;
}
const probe = () => document.querySelector('[data-testid="probe"]')?.textContent;

let root: Root | undefined;
let container: HTMLElement | undefined;

/** Mounts the provider over a server that answers each address from its own queue. */
async function open(answers: Record<string, Response[]>): Promise<string[]> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const next = answers[url]?.shift();
      if (!next) throw new Error(`unexpected request ${url}`);
      return next;
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="en">
        <OrganizerEventContextProvider slug="club" urlEventId="ev1">
          <Probe />
        </OrganizerEventContextProvider>
      </I18nProvider>,
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return asked;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe('the club list behind a lapsed login', () => {
  it('renews the login at the club read, and reads the list', async () => {
    const asked = await open({
      [CLUB]: [json({}, 401), json({ id: 'org-1', name: 'Club' })],
      [ME]: [json({ type: 'claimed' })],
      [LIST]: [json([ARCHIVED])],
    });
    expect(asked).toEqual([CLUB, ME, CLUB, LIST]);
    expect(probe()).toBe('archived|null');
  });

  it('renews the login at the list read too', async () => {
    const asked = await open({
      [CLUB]: [json({ id: 'org-1', name: 'Club' })],
      [ME]: [json({ type: 'claimed' })],
      [LIST]: [json({}, 401), json([ARCHIVED])],
    });
    expect(asked).toEqual([CLUB, LIST, ME, LIST]);
    expect(probe()).toBe('archived|null');
  });

  it('says a club read the server refused, where it said nothing', async () => {
    await open({ [CLUB]: [json({}, 403)] });
    expect(probe()).toBe('|403 Request failed');
  });
});
