/**
 * The club's Event list, read twice at once. The provider reads it when it opens; a screen reads it
 * again after its save (a Tournament created, its kind changed: the menu's Teams entry follows the
 * list). The first read can land last. Its older list must not replace the newer one.
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
const BEFORE = [{ id: 'ev1', name: 'Open', status: 'draft' }];
const AFTER = [{ id: 'ev1', name: 'Open', status: 'published' }];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function Probe() {
  const { events, eventsError, refetchEvents } = useOrganizerSelectedEvent();
  return (
    <button type="button" data-testid="probe" onClick={() => void refetchEvents()}>
      {`${events.map((e) => e.status).join(',')}|${eventsError}`}
    </button>
  );
}
const probe = () => document.querySelector<HTMLButtonElement>('[data-testid="probe"]')!;

let root: Root | undefined;
let container: HTMLElement | undefined;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe('two reads of the club Event list at once', () => {
  it.each([
    ['lands last with the older list', (ok: (r: Response) => void) => ok(json(BEFORE))],
    [
      'fails last',
      (_ok: (r: Response) => void, fail: (e: Error) => void) => fail(new Error('network down')),
    ],
  ])('keeps the newest answer when the older read %s', async (_case, land) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let releaseFirst!: () => void;
    const listAnswers: Array<() => Promise<Response>> = [
      // The provider's own read: held until the screen's read has landed.
      () =>
        new Promise<Response>((resolve, reject) => {
          releaseFirst = () => land(resolve, reject);
        }),
      async () => json(AFTER),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === CLUB) return json({ id: 'org-1', name: 'Club' });
        if (url === LIST) return listAnswers.shift()!();
        throw new Error(`unexpected request ${url}`);
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
    await settle();

    await act(async () => probe().click());
    await settle();
    expect(probe().textContent).toBe('published|null');

    await act(async () => releaseFirst());
    await settle();
    expect(probe().textContent).toBe('published|null');
  });
});
