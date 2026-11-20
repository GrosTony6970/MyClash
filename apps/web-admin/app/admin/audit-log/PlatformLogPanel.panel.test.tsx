import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { apiRequest } from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { PlatformLogPanel } from './PlatformLogPanel';

/**
 * The Platform tab's side panel (ruling 911): the whole detail text, the event link that does
 * its own job, and Resolve from the panel, after which the list drops the row and the panel shows
 * the one that took its place.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const LONG_DETAIL = `relation "matches" does not exist ${'x'.repeat(400)} END-OF-DETAIL`;
const QUERY_ERROR = {
  id: 'query_error:q1',
  category: 'query_error',
  severity: 'error',
  occurredAt: '2026-11-20T06:00:00.000Z',
  title: 'matches · 400',
  detail: LONG_DETAIL,
  actorUserId: null,
  actorName: null,
  actorEmail: null,
  href: null,
  occurrenceCount: 3,
  firstSeenAt: '2026-11-19T06:00:00.000Z',
  resolvable: true,
};
const FINDING = {
  id: 'ai_finding:f1',
  category: 'ai_finding',
  severity: 'warning',
  occurredAt: '2026-11-20T05:00:00.000Z',
  title: 'duplicate_person',
  detail: 'Two fighters look the same.',
  actorUserId: null,
  actorName: null,
  actorEmail: null,
  href: '/admin/data-quality',
};

function feed(items: unknown[]) {
  return {
    ok: true,
    data: { items, total: items.length, page: 1, perPage: 50, totalPages: 1, truncated: false },
  };
}

let root: Root;
let host: HTMLDivElement;
let feedItems: unknown[];
let resolveAnswer: unknown;

beforeAll(() => {
  // jsdom lays nothing out: give each attached element its parent, so the focus trap runs.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentNode;
    },
  });
});

beforeEach(async () => {
  feedItems = [QUERY_ERROR, FINDING];
  resolveAnswer = { ok: true, data: null };
  vi.mocked(apiRequest).mockImplementation((async (_api: string, path: string) =>
    path.includes('/resolve') ? resolveAnswer : feed(feedItems)) as never);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <PlatformLogPanel />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const rows = () => [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')];

async function key(target: Element, name: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('nothing to click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('the Platform tab', () => {
  it('opens the whole detail text, not the cut row', async () => {
    await click(rows()[0]?.cells[1]);
    expect(dialog()?.textContent).toContain('END-OF-DETAIL');
    expect(dialog()?.textContent).toContain('3 occurrences since');
  });

  it('a click on the event link does not open the panel', async () => {
    const link = rows()[1]?.querySelector('a');
    link?.addEventListener('click', (event) => event.preventDefault());
    await click(link);
    expect(dialog()).toBeNull();
  });

  it('Resolve from the panel sends the PATCH, then shows the row that took its place', async () => {
    await click(rows()[0]?.cells[1]);
    feedItems = [FINDING];
    const resolve = [...dialog()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Mark handled',
    );
    await click(resolve);
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'http://api.test',
      '/api/v1/admin/query-errors/q1/resolve',
      { method: 'PATCH' },
    );
    expect(dialog()?.textContent).toContain('Two fighters look the same.');
    expect(dialog()?.textContent).toContain('1 of 1 on this page');
  });

  it('keeps focus in the panel when the focused link leaves with its row', async () => {
    await click(rows()[1]?.cells[1]);
    dialog()?.querySelector<HTMLElement>('[data-modal-body] a')?.focus();
    expect(document.activeElement?.tagName).toBe('A');
    await key(document.activeElement!, 'ArrowUp');
    expect(dialog()?.textContent).toContain('1 of 2 on this page');
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it('Resolve holds its focus while it runs, and cannot be sent twice', async () => {
    let finishReload: () => void = () => undefined;
    await click(rows()[0]?.cells[1]);
    vi.mocked(apiRequest).mockImplementation((async (_api: string, path: string) => {
      if (path.includes('/resolve')) return resolveAnswer;
      await new Promise<void>((done) => (finishReload = done));
      return feed([FINDING]);
    }) as never);
    const resolve = () =>
      [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Mark handled');
    await click(resolve());
    expect(resolve()?.disabled).toBe(false);
    expect(resolve()?.getAttribute('aria-disabled')).toBe('true');
    await click(resolve());
    const patches = vi
      .mocked(apiRequest)
      .mock.calls.filter(([, path]) => String(path).includes('/resolve'));
    expect(patches).toHaveLength(1);
    await act(async () => finishReload());
  });

  it('a refused Resolve stays with its own entry', async () => {
    resolveAnswer = {
      ok: false,
      kind: 'http',
      status: 409,
      detail: 'This query error is already handled.',
      code: null,
      details: null,
    };
    await click(rows()[0]?.cells[1]);
    const resolve = [...dialog()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Mark handled',
    );
    await click(resolve);
    await key(dialog()!.querySelector('footer, [role="dialog"] span') ?? dialog()!, 'ArrowDown');
    expect(dialog()?.textContent).toContain('2 of 2 on this page');
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
  });

  it('a refused Resolve shows its message inside the panel', async () => {
    resolveAnswer = {
      ok: false,
      kind: 'http',
      status: 409,
      detail: 'This query error is already handled.',
      code: null,
      details: null,
    };
    await click(rows()[0]?.cells[1]);
    const resolve = [...dialog()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Mark handled',
    );
    await click(resolve);
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      'This query error is already handled.',
    );
  });
});
