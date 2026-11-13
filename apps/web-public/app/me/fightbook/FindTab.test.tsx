// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { FightBookEvent, FindCard } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FightBookClient } from './FightBookClient';
import { FindTab } from './FindTab';

/**
 * Julie looks for a partner. On top, the FightBook users at her Event: today's, a picker when two
 * run today, else the soonest; none when she is at no Event. Below, All of FightBook. One weapon
 * filter narrows both; an ask sent from a card tells the page.
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

type Answer = { ok: boolean; data?: unknown; kind?: string; status?: number };
type Route = Answer | (() => Answer);

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const event = (id: string, name: string, days: string[], today: string | null) =>
  ({ id, name, days, today, freeUntil: null }) satisfies FightBookEvent;
const card = (n: number): FindCard => ({
  fighter: {
    globalPersonId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name: `Probe Fighter ${n}`,
    photoUrl: null,
    club: null,
  },
  weapons: ['Longsword'],
});
const ok = (data: unknown): Answer => ({ ok: true, data });
const atEvent = (id: string, query = '') => `/api/v1/me/fightbook/events/${id}/find${query}`;
const BROWSE = '/api/v1/me/fightbook/find?page=0';

let container: HTMLDivElement;
let root: Root;
let onSent: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSent = vi.fn();
  search = new URLSearchParams();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
});

function serve(events: FightBookEvent[], routes: Record<string, Route> = {}) {
  const all: Record<string, Route> = {
    '/api/v1/me/fightbook/events': ok(events),
    '/api/v1/weapons?active=true': ok([
      { id: 'w1', name: 'Longsword' },
      { id: 'w2', name: 'Sabre' },
    ]),
    [BROWSE]: ok({ items: [], more: false }),
    // The floor tools read the open calls of any Event with an open day; these tests are not about them.
    ...Object.fromEntries(
      events.map((e) => [
        `/api/v1/me/fightbook/events/${e.id}/calls`,
        ok({ mine: [], others: [] }),
      ]),
    ),
    ...routes,
  };
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    const route = all[`${init?.method === 'POST' ? 'POST ' : ''}${path}`];
    if (!route) throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`);
    return (typeof route === 'function' ? route() : route) as never;
  });
}

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FindTab apiUrl="http://api.test" onSent={onSent} />
      </I18nProvider>,
    ),
  );
  await settled();
}
const reads = () => vi.mocked(apiRequest).mock.calls.map(([, path]) => path);
const select = (label: string) =>
  [...container.querySelectorAll('label')]
    .find((l) => l.textContent === label)
    ?.parentElement?.querySelector('select') ?? null;
async function choose(control: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
      control,
      value,
    );
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settled();
}
const blockHeading = () =>
  [...container.querySelectorAll('h2')].find((h) => h.textContent?.startsWith('FightBook users'));
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);

describe('the Find a partner tab', () => {
  it('opens on ?tab=find', async () => {
    search = new URLSearchParams('tab=find');
    serve([], {
      '/api/v1/me/fightbook/settings': ok({ hasProfile: true, enabled: true }),
      '/api/v1/me/fightbook/inbox': ok([]),
      '/api/v1/me/fightbook/spars': ok({ spars: [], sent: [] }),
      '/api/v1/me/fightbook/blocks': ok([]),
    });
    await act(async () =>
      root.render(
        <I18nProvider locale="en">
          <FightBookClient />
        </I18nProvider>,
      ),
    );
    await settled();
    await settled();
    expect(container.textContent).toContain('Find a partner');
    expect(container.textContent).toContain('All of FightBook');
    expect(reads()).toContain(BROWSE);
  });

  it('Review Focus 5: two Events today show a picker, the first by default; switching re-reads', async () => {
    serve(
      [
        event(EVENT_A, 'Open Alpha', ['2026-11-12'], '2026-11-12'),
        event(EVENT_B, 'Open Beta', ['2026-11-12', '2026-11-13'], '2026-11-12'),
      ],
      { [atEvent(EVENT_A)]: ok([card(1)]), [atEvent(EVENT_B)]: ok([card(2)]) },
    );
    await open();
    const picker = select('Event')!;
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Open Alpha', 'Open Beta']);
    expect(picker.value).toBe(EVENT_A);
    expect(blockHeading()?.textContent).toBe('FightBook users at Open Alpha');
    expect(container.textContent).toContain('Probe Fighter 1');
    await choose(picker, EVENT_B);
    expect(reads()).toContain(atEvent(EVENT_B));
    expect(blockHeading()?.textContent).toBe('FightBook users at Open Beta');
    expect(container.textContent).toContain('Probe Fighter 2');
    expect(container.textContent).not.toContain('Probe Fighter 1');
  });

  it("one Event today and one next month: no picker, today's", async () => {
    serve(
      [
        event(EVENT_A, 'Open Alpha', ['2026-11-12'], '2026-11-12'),
        event(EVENT_B, 'Open Beta', ['2026-12-10'], null),
      ],
      { [atEvent(EVENT_A)]: ok([card(1)]) },
    );
    await open();
    expect(select('Event')).toBeNull();
    expect(blockHeading()?.textContent).toBe('FightBook users at Open Alpha');
    expect(reads()).not.toContain(atEvent(EVENT_B));
  });

  it('no Event today and two upcoming: no picker, the soonest', async () => {
    serve(
      [
        event(EVENT_B, 'Open Beta', ['2026-11-20'], null),
        event(EVENT_A, 'Open Alpha', ['2026-12-10'], null),
      ],
      { [atEvent(EVENT_B)]: ok([]) },
    );
    await open();
    expect(select('Event')).toBeNull();
    expect(blockHeading()?.textContent).toBe('FightBook users at Open Beta');
    expect(container.textContent).toContain('No one to show at this Event.');
  });

  it('Review Focus 3: at no Event, no Event block, All of FightBook alone', async () => {
    serve([]);
    await open();
    expect(blockHeading()).toBeUndefined();
    expect(reads().some((path) => path.includes('/events/') && path.endsWith('/find'))).toBe(false);
    expect(container.textContent).toContain('All of FightBook');
  });

  it('the weapon select reads both lists again with the weapon id', async () => {
    serve([event(EVENT_A, 'Open Alpha', ['2026-11-12'], '2026-11-12')], {
      [atEvent(EVENT_A)]: ok([card(1)]),
      [atEvent(EVENT_A, '?weapon=w2')]: ok([]),
      '/api/v1/me/fightbook/find?weapon=w2&page=0': ok({ items: [card(3)], more: false }),
    });
    await open();
    const weapon = select('Weapon')!;
    expect([...weapon.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Any weapon'],
      ['w1', 'Longsword'],
      ['w2', 'Sabre'],
    ]);
    await choose(weapon, 'w2');
    expect(reads()).toContain(atEvent(EVENT_A, '?weapon=w2'));
    expect(reads()).toContain('/api/v1/me/fightbook/find?weapon=w2&page=0');
    expect(container.textContent).not.toContain('Probe Fighter 1');
    expect(container.textContent).toContain('Probe Fighter 3');
  });

  it('a failed Event block read says so and reads again on "Try again"', async () => {
    let fails = true;
    serve([event(EVENT_A, 'Open Alpha', ['2026-11-12'], '2026-11-12')], {
      [atEvent(EVENT_A)]: () => (fails ? { ok: false, kind: 'http', status: 503 } : ok([card(1)])),
    });
    await open();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('The fighters at this Event could not be loaded.');
    fails = false;
    await act(async () => button('Try again', alert)!.click());
    await settled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Probe Fighter 1');
  });

  it('a failed read of my Events and the weapons says so and reads again', async () => {
    let fails = true;
    serve([], {
      '/api/v1/me/fightbook/events': () =>
        fails ? { ok: false, kind: 'http', status: 503 } : ok([]),
    });
    await open();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Find a partner could not be loaded.');
    expect(select('Weapon')).toBeNull();
    fails = false;
    await act(async () => button('Try again', alert)!.click());
    await settled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(select('Weapon')).not.toBeNull();
  });

  it("an ask sent from an Event card names the block's Event and tells the page", async () => {
    serve(
      [
        event(EVENT_A, 'Open Alpha', ['2026-11-12'], '2026-11-12'),
        event(EVENT_B, 'Open Beta', ['2026-11-12'], '2026-11-12'),
      ],
      {
        [atEvent(EVENT_A)]: ok([]),
        [atEvent(EVENT_B)]: ok([card(2)]),
        'POST /api/v1/me/fightbook/requests': ok({ id: 'r-1' }),
      },
    );
    await open();
    // Open Beta is not the dialog's own default (that is the first Event): the card names it.
    await choose(select('Event')!, EVENT_B);
    const cardItem = container.querySelector('[data-find-card]')!;
    await act(async () => button('Ask to spar', cardItem)!.click());
    await settled();
    const dialog = document.body.querySelector('[role="dialog"]')!;
    await act(async () =>
      [...dialog.querySelectorAll('label')]
        .find((l) => l.textContent === 'Longsword')!
        .querySelector('input')!
        .click(),
    );
    await act(async () => button('Send the request', dialog)!.click());
    await settled();
    const post = vi.mocked(apiRequest).mock.calls.find(([, , init]) => init?.method === 'POST');
    expect(post?.[2]?.body).toMatchObject({ kind: 'event', eventId: EVENT_B });
    expect(onSent).toHaveBeenCalledTimes(1);
  });
});
