// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { ThankYou, ThanksPage } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { MySparsTab } from './MySparsTab';
import { ThanksList } from './ThanksList';

/** The thank-yous Hugo received, newest first, 20 a page with "Show more" (the Find pattern). */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Answer = { ok: boolean; data?: unknown; kind?: string; status?: number };
type Route = Answer | (() => Answer | Promise<Answer>);

const thank = (n: number, over: Partial<ThankYou> = {}): ThankYou => ({
  id: `thank-${n}`,
  from: { globalPersonId: `gp-${n}`, name: `Probe Fighter ${n}`, photoUrl: null, club: null },
  stars: 4,
  text: null,
  kind: 'event',
  eventName: 'Probe Open',
  day: '2026-05-02',
  time: null,
  place: null,
  weapons: ['Longsword'],
  ...over,
});
const page = (items: ThankYou[], more: boolean): Answer => ({
  ok: true,
  data: { items, more } satisfies ThanksPage,
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
});

function serve(routes: Record<string, Route>) {
  vi.mocked(apiRequest).mockImplementation(async (_base, path) => {
    const route = routes[path];
    if (!route) throw new Error(`unexpected request ${path}`);
    return (typeof route === 'function' ? await route() : route) as never;
  });
}
function later() {
  let land: (answer: Answer) => void = () => {};
  const route = () => new Promise<Answer>((resolve) => (land = resolve));
  return { route, land: (answer: Answer) => act(async () => land(answer)) };
}
const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const reads = () => vi.mocked(apiRequest).mock.calls.map(([, path]) => path);
const cards = () => [...container.querySelectorAll('[data-spar-card]')];
const names = () => cards().map((li) => li.querySelector('p')?.textContent);
const showMore = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Show more');

async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <ThanksList apiUrl="http://api.test" />
      </I18nProvider>,
    ),
  );
  await settled();
}

const P0 = '/api/v1/me/fightbook/thanks?page=0';
const P1 = '/api/v1/me/fightbook/thanks?page=1';

describe('The thank-yous you received', () => {
  it('reads the first page when it opens, and "Show more" appends the next while there is more', async () => {
    serve({ [P0]: page([thank(1), thank(2)], true), [P1]: page([thank(3)], false) });
    await open();
    expect(reads()).toEqual([P0]);
    expect(names()).toEqual(['Probe Fighter 1', 'Probe Fighter 2']);
    await act(async () => showMore()!.click());
    await settled();
    expect(reads()).toEqual([P0, P1]);
    expect(names()).toEqual(['Probe Fighter 1', 'Probe Fighter 2', 'Probe Fighter 3']);
    expect(showMore()).toBeUndefined();
  });

  it('an answer for an older page is dropped', async () => {
    const first = later();
    serve({ [P0]: first.route });
    await open();
    // Unmounted and opened again before the first read answers: that answer lands nowhere.
    await act(async () => root.render(<></>));
    serve({ [P0]: page([thank(5)], false) });
    await open();
    await first.land(page([thank(1), thank(2)], true));
    await settled();
    expect(names()).toEqual(['Probe Fighter 5']);
    expect(showMore()).toBeUndefined();
  });

  it('a card already shown is not shown twice when the next page repeats it', async () => {
    serve({ [P0]: page([thank(1), thank(2)], true), [P1]: page([thank(2), thank(3)], false) });
    await open();
    await act(async () => showMore()!.click());
    await settled();
    expect(names()).toEqual(['Probe Fighter 1', 'Probe Fighter 2', 'Probe Fighter 3']);
  });

  it('none yet says so, with no button', async () => {
    serve({ [P0]: page([], false) });
    await open();
    expect(container.textContent).toContain('No thank-yous yet');
    expect(cards()).toHaveLength(0);
    expect(showMore()).toBeUndefined();
  });

  it('each card shows the photo, name, stars, which spar and the words', async () => {
    serve({
      [P0]: page(
        [
          thank(1, {
            from: {
              globalPersonId: 'gp-1',
              name: 'Probe Fighter 1',
              photoUrl: 'https://cdn.test/p1.jpg',
              club: null,
            },
            stars: 5,
            text: 'Merci, great bout',
          }),
          thank(2, {
            kind: 'free',
            eventName: null,
            place: 'Salle Probe',
            weapons: ['Sabre', 'Rapier'],
          }),
        ],
        false,
      ),
    });
    await open();
    const [withEvent, free] = cards();
    expect(withEvent!.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/p1.jpg');
    expect(withEvent!.querySelector('[role="img"][aria-label="5 of 5"]')?.textContent).toBe('★ 5');
    expect(withEvent!.textContent).toContain('Probe Open');
    expect(withEvent!.textContent).toContain('Weapons: Longsword');
    expect(withEvent!.textContent).toContain('Merci, great bout');
    expect(free!.textContent).toContain('Salle Probe');
    expect(free!.textContent).toContain('Weapons: Sabre, Rapier');
    expect(free!.querySelector('[role="img"][aria-label="4 of 5"]')?.textContent).toBe('★ 4');
  });

  it('a failed read says so and reads again on "Try again"', async () => {
    let fails = true;
    serve({
      [P0]: () => (fails ? { ok: false, kind: 'http', status: 503 } : page([thank(1)], false)),
    });
    await open();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'The thank-yous could not be loaded.',
    );
    fails = false;
    await act(async () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!.click(),
    );
    await settled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(names()).toEqual(['Probe Fighter 1']);
  });

  it('with no spar in the last 30 days, My spars says so and still lists the thank-yous', async () => {
    serve({ [P0]: page([thank(1)], false) });
    const noop = vi.fn();
    await act(async () =>
      root.render(
        <I18nProvider locale="en">
          <MySparsTab
            apiUrl="http://api.test"
            spars={{ spars: [], sent: [] }}
            onCancelled={noop}
            onWithdrawn={noop}
            onMarked={noop}
            onUndone={noop}
            onReviewed={noop}
            onNoted={noop}
            onFlagged={noop}
            onStale={noop}
          />
        </I18nProvider>,
      ),
    );
    await settled();
    expect(container.textContent).toContain('No spar yet');
    expect(names()).toEqual(['Probe Fighter 1']);
  });
});
