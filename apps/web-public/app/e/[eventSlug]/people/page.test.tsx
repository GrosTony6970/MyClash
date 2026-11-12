// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, fetchMe } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../src/i18n/I18nProvider';
import PeoplePage from './page';

/**
 * Lea searches an Event's people. The search waits 250 ms after the last key, then asks the API;
 * each new search aborts the one before it, so an older answer never paints rows over a newer
 * query. A signed-in fighter also sees "Ask to spar" on the rows the API says she may ask.
 */
vi.mock('next/navigation', () => ({ useParams: () => ({ eventSlug: 'open-2027' }) }));
vi.mock('next/link', () => ({
  default: (props: { href: string; className?: string; children?: ReactNode }) => (
    <a href={props.href} className={props.className}>
      {props.children}
    </a>
  ),
}));
vi.mock('../_components/EventHeader', () => ({
  fetchEventInfo: async () => ({ kind: 'found', event: { id: EVENT } }),
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
  fetchMe: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = '5d0c1f0e-3f7b-4a39-9a4e-2b8e9c7d1a10';
const person = (id: string, givenName: string) => ({
  id,
  given_name: givenName,
  family_name: 'Probe',
  club_label: null,
  roles: [],
});
const PAUL = person('p-paul', 'Paul');
const PABLO = person('p-pablo', 'Pablo');

/** One lookup the test answers by hand. An abort rejects it, as the browser's `fetch` does. */
interface Lookup {
  url: string;
  answer: (rows: unknown[]) => void;
}

let container: HTMLDivElement;
let root: Root;
let lookups: Lookup[];
/** The `askable` reads, by path, each waiting until the test answers it. */
let askables: Map<string, (result: unknown) => void>;
beforeEach(() => {
  lookups = [];
  askables = new Map();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
          lookups.push({ url, answer: (rows) => resolve(new Response(JSON.stringify(rows))) });
        }),
    ),
  );
  vi.mocked(apiRequest).mockImplementation(
    (_api, path) => new Promise((resolve) => askables.set(path, resolve)) as never,
  );
  signedAs('anonymous');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.mocked(apiRequest).mockReset();
  vi.mocked(fetchMe).mockReset();
});

function signedAs(type: 'claimed' | 'guest' | 'anonymous') {
  vi.mocked(fetchMe).mockResolvedValue({ ok: true, data: { type } } as never);
}

const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

/** Types into the search box as a person does: React hears the input event. */
async function type(value: string) {
  const input = container.querySelector('input') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function show() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <PeoplePage />
      </I18nProvider>,
    ),
  );
  await wait(0);
}

/** Types a query, waits out the debounce, and answers its lookup with these rows. */
async function search(query: string, found: unknown[]) {
  await type(query);
  await wait(300);
  await act(async () => lookups.at(-1)?.answer(found));
  await wait(0);
}

const rows = () => container.querySelectorAll('li');
const askPath = (ids: string[]) =>
  `/api/v1/me/fightbook/events/${EVENT}/askable?${new URLSearchParams({ persons: ids.join(',') })}`;
const askableReads = () =>
  vi.mocked(apiRequest).mock.calls.filter(([, path]) => path.includes('/askable'));
const askButtons = () =>
  [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Ask to spar');

describe('the people search', () => {
  it('shows the rows a search finds', async () => {
    await show();
    await type('Pau');
    await wait(300);
    expect(lookups.map((l) => new URL(l.url).pathname + new URL(l.url).search)).toEqual([
      `/api/v1/events/${EVENT}/persons/lookup?q=Pau`,
    ]);
    await act(async () => lookups[0]?.answer([PAUL]));
    expect(rows()).toHaveLength(1);
  });

  it('stays empty when the search is cleared before the older answer lands', async () => {
    await show();
    await type('Pau');
    await wait(300);
    await type('P');
    await wait(300);
    await act(async () => lookups[0]?.answer([PAUL]));
    await wait(0);
    expect(rows()).toHaveLength(0);
  });
});

describe('"Ask to spar" on the people search', () => {
  it('reads askable once for the listed rows, and draws the button beside the link', async () => {
    signedAs('claimed');
    await show();
    await search('Pa', [PABLO, PAUL]);
    expect(askableReads().map(([, path]) => path)).toEqual([askPath(['p-pablo', 'p-paul'])]);
    await act(async () =>
      askables.get(askPath(['p-pablo', 'p-paul']))?.({
        ok: true,
        data: { 'p-paul': 'g-paul' },
      }),
    );
    expect(askButtons()).toHaveLength(1);
    const [button] = askButtons();
    expect(button?.closest('li')?.textContent).toContain('Paul Probe');
    expect(button?.closest('a')).toBeNull();
  });

  it('opens the person on a tap anywhere in the row but the button', async () => {
    signedAs('claimed');
    await show();
    await search('Pau', [PAUL]);
    await act(async () =>
      askables.get(askPath(['p-paul']))?.({ ok: true, data: { 'p-paul': 'g-paul' } }),
    );
    const row = rows()[0];
    const link = row?.querySelector('a');
    // The padding is the link's, not the row's: the row's padded bands are part of the link.
    expect(link?.className.split(' ')).toEqual(expect.arrayContaining(['flex-1', 'px-4', 'py-3']));
    expect(row?.className).not.toMatch(/\b(p|px|py)-\d/);
    expect(row?.className.split(' ')).toContain('items-stretch');
    expect(link?.textContent).toContain('Paul Probe');
    expect(askButtons()[0]?.closest('a')).toBeNull();
  });

  it('paints no button from the answer for "Pa" once the rows show "Pau"', async () => {
    signedAs('claimed');
    await show();
    await search('Pa', [PABLO, PAUL]);
    await search('Pau', [PAUL]);
    await act(async () =>
      askables.get(askPath(['p-pablo', 'p-paul']))?.({
        ok: true,
        data: { 'p-pablo': 'g-pablo', 'p-paul': 'g-paul' },
      }),
    );
    expect(askButtons()).toHaveLength(0);
    await act(async () =>
      askables.get(askPath(['p-paul']))?.({
        ok: true,
        data: { 'p-paul': 'g-paul' },
      }),
    );
    expect(askButtons()).toHaveLength(1);
  });

  it.each(['anonymous', 'guest'] as const)('reads nothing when /me answers %s', async (type) => {
    signedAs(type);
    await show();
    await search('Pau', [PAUL]);
    expect(fetchMe).toHaveBeenCalledTimes(1);
    expect(askableReads()).toHaveLength(0);
    expect(askButtons()).toHaveLength(0);
  });

  it('reads nothing while /me has not answered', async () => {
    vi.mocked(fetchMe).mockReturnValue(new Promise(() => undefined) as never);
    await show();
    await search('Pau', [PAUL]);
    expect(rows()).toHaveLength(1);
    expect(askableReads()).toHaveLength(0);
  });

  it('reads nothing and draws nothing when /me fails', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ ok: false, kind: 'network' } as never);
    await show();
    await search('Pau', [PAUL]);
    expect(rows()).toHaveLength(1);
    expect(askableReads()).toHaveLength(0);
    expect(askButtons()).toHaveLength(0);
  });
});
