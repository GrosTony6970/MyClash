// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../src/i18n/I18nProvider';
import PeoplePage from './page';

/**
 * Lea searches an Event's people. The search waits 250 ms after the last key, then asks the API;
 * each new search aborts the one before it, so an older answer never paints rows over a newer
 * query.
 */
vi.mock('next/navigation', () => ({ useParams: () => ({ eventSlug: 'open-2027' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../_components/EventHeader', () => ({
  fetchEventInfo: async () => ({ kind: 'found', event: { id: EVENT } }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = '5d0c1f0e-3f7b-4a39-9a4e-2b8e9c7d1a10';
const PAUL = {
  id: 'p-paul',
  given_name: 'Paul',
  family_name: 'Probe',
  club_label: null,
  roles: [],
};

/** One lookup the test answers by hand. An abort rejects it, as the browser's `fetch` does. */
interface Lookup {
  url: string;
  answer: (rows: unknown[]) => void;
}

let container: HTMLDivElement;
let root: Root;
let lookups: Lookup[];
beforeEach(() => {
  lookups = [];
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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

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

const rows = () => container.querySelectorAll('li');

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
