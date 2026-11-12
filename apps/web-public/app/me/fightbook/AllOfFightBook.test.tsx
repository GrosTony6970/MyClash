// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { FindCard, FindPage } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { AllOfFightBook } from './AllOfFightBook';
import { useFightBookBrowse } from './use-fightbook-browse';

/**
 * Hugo looks through all of FightBook, 20 fighters a page. "Show more" adds the next page; a name
 * or a weapon starts again from the first page, and nothing of an older search lands under it.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Answer = { ok: boolean; data?: unknown; kind?: string; status?: number };
type Route = Answer | (() => Answer | Promise<Answer>);

const card = (n: number, over: Partial<FindCard['fighter']> = {}): FindCard => ({
  fighter: {
    globalPersonId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name: `Probe Fighter ${n}`,
    photoUrl: null,
    club: null,
    ...over,
  },
  weapons: ['Longsword'],
});
const page = (items: FindCard[], more: boolean): Answer => ({
  ok: true,
  data: { items, more } satisfies FindPage,
});

let container: HTMLDivElement;
let root: Root;
let onSent: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSent = vi.fn();
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
/** A read that answers when the test says. */
function later() {
  let land: (answer: Answer) => void = () => {};
  const route = () => new Promise<Answer>((resolve) => (land = resolve));
  return { route, land: (answer: Answer) => act(async () => land(answer)) };
}

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
/** Past the name box's 250 ms wait. */
const debounced = () => act(async () => new Promise((resolve) => setTimeout(resolve, 300)));

async function open(weapon = '') {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <AllOfFightBook apiUrl="http://api.test" weapon={weapon} onSent={onSent} />
      </I18nProvider>,
    ),
  );
  await settled();
}
const names = () =>
  [...container.querySelectorAll('[data-find-card]')].map(
    (li) => li.querySelector('p')?.textContent,
  );
const showMore = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Show more');
const reads = () => vi.mocked(apiRequest).mock.calls.map(([, path]) => path);
async function typeName(value: string) {
  const box = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const P0 = '/api/v1/me/fightbook/find?page=0';
const P1 = '/api/v1/me/fightbook/find?page=1';

describe('All of FightBook', () => {
  it('reads the first page with the tab, and "Show more" appends the next while there is more', async () => {
    serve({ [P0]: page([card(1), card(2)], true), [P1]: page([card(3)], false) });
    await open();
    expect(reads()).toEqual([P0]);
    expect(names()).toEqual(['Probe Fighter 1', 'Probe Fighter 2']);
    await act(async () => showMore()!.click());
    await settled();
    expect(reads()).toEqual([P0, P1]);
    expect(names()).toEqual(['Probe Fighter 1', 'Probe Fighter 2', 'Probe Fighter 3']);
    // No further page: no button.
    expect(showMore()).toBeUndefined();
  });

  it('a name reads the first page again and replaces the list; under 2 letters is everyone', async () => {
    serve({
      [P0]: page([card(1), card(2)], true),
      [P1]: page([card(3)], false),
      '/api/v1/me/fightbook/find?q=Pa&page=0': page([card(7)], false),
    });
    await open();
    await act(async () => showMore()!.click());
    await settled();
    await typeName('P');
    await debounced();
    // One letter narrows nothing: no new read.
    expect(reads()).toEqual([P0, P1]);
    await typeName('Pa');
    await debounced();
    expect(reads().at(-1)).toBe('/api/v1/me/fightbook/find?q=Pa&page=0');
    expect(names()).toEqual(['Probe Fighter 7']);
    // Back under 2 letters: everyone again, from the first page.
    await typeName('P');
    await debounced();
    expect(reads().at(-1)).toBe(P0);
    expect(names()).toEqual(['Probe Fighter 1', 'Probe Fighter 2']);
  });

  it('a weapon reads the first page again with its id and replaces the list', async () => {
    serve({
      [P0]: page([card(1), card(2)], true),
      [P1]: page([card(3)], false),
      '/api/v1/me/fightbook/find?weapon=w1&page=0': page([card(9)], false),
    });
    await open();
    await act(async () => showMore()!.click());
    await settled();
    await open('w1');
    expect(reads().at(-1)).toBe('/api/v1/me/fightbook/find?weapon=w1&page=0');
    expect(names()).toEqual(['Probe Fighter 9']);
    expect(showMore()).toBeUndefined();
  });

  it('Review Focus 7: a page of the old list answering after a new name lands nowhere', async () => {
    const oldPage1 = later();
    serve({
      [P0]: page([card(1), card(2)], true),
      [P1]: oldPage1.route,
      '/api/v1/me/fightbook/find?q=Hugo&page=0': page([card(5)], false),
    });
    await open();
    await act(async () => showMore()!.click());
    await typeName('Hugo');
    await debounced();
    expect(names()).toEqual(['Probe Fighter 5']);
    await oldPage1.land(page([card(3), card(4)], false));
    await settled();
    expect(names()).toEqual(['Probe Fighter 5']);
  });

  it('a card already shown is not shown twice when the next page repeats it', async () => {
    // Someone switched FightBook on between the two reads: the pages shifted by one.
    serve({ [P0]: page([card(1), card(2)], true), [P1]: page([card(2), card(3)], false) });
    await open();
    await act(async () => showMore()!.click());
    await settled();
    expect(names()).toEqual(['Probe Fighter 1', 'Probe Fighter 2', 'Probe Fighter 3']);
  });

  it("each card shows the fighter's photo, or their initials when there is none", async () => {
    serve({
      [P0]: page(
        [card(1, { photoUrl: 'https://cdn.test/p1.jpg', club: 'Salle Probe' }), card(2)],
        false,
      ),
    });
    await open();
    const [withPhoto, without] = [...container.querySelectorAll('[data-find-card]')];
    expect(withPhoto!.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/p1.jpg');
    expect(withPhoto!.textContent).toContain('Salle Probe');
    expect(withPhoto!.textContent).toContain('Weapons: Longsword');
    expect(without!.querySelector('img')).toBeNull();
    expect(without!.querySelector('[aria-label="Probe Fighter 2"]')?.textContent).toBe('PF');
    expect(withPhoto!.querySelector('button')?.textContent).toBe('Ask to spar');
  });

  it('a failed read says so and reads again on "Try again"', async () => {
    let fails = true;
    serve({
      [P0]: () => (fails ? { ok: false, kind: 'http', status: 503 } : page([card(1)], false)),
    });
    await open();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'The fighters could not be loaded.',
    );
    fails = false;
    await act(async () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!.click(),
    );
    await settled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(names()).toEqual(['Probe Fighter 1']);
  });

  it('an ask sent from a card tells the page', async () => {
    serve({
      [P0]: page([card(1)], false),
      '/api/v1/me/fightbook/events': { ok: true, data: [] },
      '/api/v1/weapons?active=true': { ok: true, data: [{ id: 'w1', name: 'Longsword' }] },
      '/api/v1/me/fightbook/requests': { ok: true, data: { id: 'r-1' } },
    });
    await open();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-find-card] button')!.click(),
    );
    await settled();
    const dialog = document.body.querySelector('[role="dialog"]')!;
    // At no Event: a free date, which needs a place.
    const place = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        place,
        'Salle',
      );
      place.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    await act(async () =>
      [...dialog.querySelectorAll('button')]
        .find((b) => b.textContent === 'Send the request')!
        .click(),
    );
    await settled();
    expect(onSent).toHaveBeenCalledTimes(1);
  });
});

/** The hook alone, with no `key` from its caller: it owns the restart at page 0 itself. */
function Probe({ name }: { name: string }) {
  const browse = useFightBookBrowse('http://api.test', name, '');
  return (
    <>
      <ul>
        {browse.items?.map((c) => (
          <li key={c.fighter.globalPersonId} data-find-card>
            <p>{c.fighter.name}</p>
          </li>
        ))}
      </ul>
      {browse.more ? (
        <button type="button" onClick={browse.showMore}>
          Show more
        </button>
      ) : null}
    </>
  );
}

describe('useFightBookBrowse', () => {
  it('a new name, without a remount, reads page 0 of the new search only', async () => {
    serve({
      [P0]: page([card(1), card(2)], true),
      [P1]: page([card(3)], false),
      '/api/v1/me/fightbook/find?q=Hugo&page=0': page([card(5)], false),
    });
    const probe = (name: string) => act(async () => root.render(<Probe name={name} />));
    await probe('');
    await settled();
    await act(async () => showMore()!.click());
    await settled();
    expect(names()).toHaveLength(3);
    await probe('Hugo');
    await settled();
    expect(reads().at(-1)).toBe('/api/v1/me/fightbook/find?q=Hugo&page=0');
    expect(names()).toEqual(['Probe Fighter 5']);
    // Back to everyone: page 0 again, not the page 1 that search had reached.
    await probe('');
    await settled();
    expect(reads().at(-1)).toBe(P0);
    expect(names()).toEqual(['Probe Fighter 1', 'Probe Fighter 2']);
  });
});
