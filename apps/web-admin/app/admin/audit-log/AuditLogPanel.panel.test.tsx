import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { apiRequest } from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AuditLogPanel } from './AuditLogPanel';

/**
 * The Audit tab's side panel (rulings 911-914): a row opens it, Previous / Next and the arrow
 * keys move through the page, Escape closes it and gives focus back to the row it shows.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const ROWS = [
  {
    id: 'a1',
    actor_user_id: 'u1',
    actorName: 'Claude (ops agent)',
    actorEmail: null,
    action: 'system.component.restart',
    entity_type: 'system_component',
    entity_id: 'web-public',
    entityLabel: null,
    payload_json: { ok: false, exitCode: 1, timedOut: false, extra: { a: 1 }, b: 2, c: 3, d: 4 },
    payloadLabels: {},
    created_at: '2026-11-20T06:05:00.000Z',
    outcome: 'failed',
  },
  {
    id: 'a2',
    actor_user_id: 'u2',
    actorName: 'Tonio',
    actorEmail: 'operator@example.test',
    action: 'event.update',
    entity_type: 'event',
    entity_id: 'ev-1',
    entityLabel: 'Open 2026',
    payload_json: { name: 'Open 2026' },
    payloadLabels: {},
    created_at: '2026-11-20T05:00:00.000Z',
    outcome: null,
  },
  {
    id: 'a3',
    actor_user_id: null,
    action: 'system.disk.prune',
    entity_type: 'system_disk',
    entity_id: 'docker',
    entityLabel: null,
    payload_json: { ok: true, exitCode: 0, timedOut: false, freedBytes: 10 },
    payloadLabels: {},
    created_at: '2026-11-20T04:00:00.000Z',
    outcome: 'succeeded',
  },
];

let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
  // jsdom lays nothing out, so every element has a null offsetParent and the focus trap would
  // see no focusable element. Give each attached element its parent, as a browser would.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentNode;
    },
  });
});

beforeEach(async () => {
  vi.mocked(apiRequest).mockResolvedValue({
    ok: true,
    data: { items: ROWS, total: 3, page: 1, perPage: 50, totalPages: 1 },
  } as never);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <AuditLogPanel />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
/** A button of the side panel (the list has its own Previous / Next for its pages). */
const button = (name: string) =>
  [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.textContent?.trim() === name,
  );
const rows = () => [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')];

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('nothing to click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function key(target: Element, name: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
}

describe('the Audit tab', () => {
  it('marks each row with its result, and a dash with a spoken name for none', () => {
    const results = rows().map((row) => row.cells[1]?.textContent);
    expect(results).toEqual(['Failed', '—No result recorded', 'Succeeded']);
  });

  it('opens a side panel on a row click, with the whole record', async () => {
    await click(rows()[0]?.cells[3]);
    const panel = dialog();
    expect(panel?.className).toContain('max-w-xl');
    expect(panel?.className).not.toContain('shadow-xl');
    expect(panel?.textContent).toContain('system.component.restart');
    expect(panel?.textContent).toContain('Claude (ops agent)');
    expect(panel?.textContent).toContain('Failed');
    expect(panel?.textContent).toContain('exit code 1');
    expect(panel?.textContent).toContain('1 of 3 on this page');
    expect(rows()[0]?.getAttribute('aria-current')).toBe('true');
  });

  it('moves with Next and the arrow keys, and stays put at the page edge', async () => {
    await click(rows()[1]?.cells[3]);
    await click(button('Next'));
    expect(dialog()?.textContent).toContain('system.disk.prune');
    expect(dialog()?.textContent).toContain('3 of 3 on this page');

    const next = button('Next');
    next?.focus();
    await click(next);
    expect(dialog()?.textContent).toContain('3 of 3 on this page');
    expect(document.activeElement).toBe(next);

    await key(next!, 'ArrowUp');
    expect(dialog()?.textContent).toContain('2 of 3 on this page');

    const body = dialog()?.querySelector('[data-modal-body]');
    await key(body!, 'ArrowDown');
    expect(dialog()?.textContent).toContain('2 of 3 on this page');
  });

  it('closes on Escape and gives focus to the time button of the row it showed', async () => {
    await click(rows()[0]?.cells[3]);
    await click(button('Next'));
    await key(document.body, 'Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement?.getAttribute('data-entry-open')).toBe('a2');
  });

  it('a click on the Details button, or in its pop-up, does not open the panel', async () => {
    await click(rows()[0]?.querySelector('td:last-child button'));
    const details = dialog();
    expect(details?.textContent).toContain('Payload details');
    await click(details?.parentElement);
    await click(details?.querySelector('li'));
    expect(document.querySelectorAll('[role="dialog"]').length).toBeLessThanOrEqual(1);
    expect(document.body.textContent).not.toContain('on this page');
  });
});
