/**
 * A page of an ARCHIVED Event, opened in a test (ruling 377).
 *
 * An Event archives itself a day after its last Tournament, and the server then
 * refuses almost every save. A page that still offers the button lets the
 * organiser tap, wait, and read a refusal. So the test does what she would do:
 * it fills every field, ticks every box, changes every select, picks a file and
 * presses every button the page left live, several rounds deep so a dialog's own
 * buttons are pressed too. Then it lists the saves the page sent. The list holds
 * only what the server takes on an archived Event.
 *
 * The test file owns its `vi.mock` calls (they are hoisted per file): `next/navigation`,
 * `next/link`, `@/lib/api-url` answering `API`, and `@myclash/api-client` with
 * `apiRequest: vi.fn()`.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import { OrganizerEventContextProvider } from '@/components/organizer-event-context';
import { I18nProvider } from '@/i18n/I18nProvider';

// Pressing everything takes seconds alone and several times that beside the other
// packages' tests: two files ran out of the default five in the gate chain.
vi.setConfig({ testTimeout: 60_000 });

export const API = 'http://api.test';
export const EVENT_ID = 'ev1';
export const ARCHIVED_EVENT = { id: EVENT_ID, name: 'Open 2025', status: 'archived' };

const SLUG = 'club';
const ORG_ID = 'org-1';
const ORG_READ = `/api/v1/organizations/slug/${SLUG}`;
/** The club's own Event list: where a page takes its Event's status from (ruling 380). */
export const EVENTS_READ = `/api/v1/organizations/${ORG_ID}/events`;
const EVENT_READ = `/api/v1/events/${EVENT_ID}`;

/** What the server answers a refused save on an archived Event. */
const REFUSAL = {
  ok: false as const,
  kind: 'unauthenticated' as const,
  status: 403 as const,
  detail: 'This event is archived and read-only.',
  code: 'event_archived',
  details: null,
};

export interface OpenedPage {
  /** Every save the page sent, as `METHOD path`, in order. */
  writes: () => string[];
  /** Fills, ticks, changes and presses everything the page left live. */
  pressEverything: (rounds?: number) => Promise<void>;
  settle: () => Promise<void>;
  unmount: () => void;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Sets a field's value the way a keystroke does, so React hears it. */
export function type(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(field) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
  const event = field instanceof HTMLSelectElement ? 'change' : 'input';
  field.dispatchEvent(new Event(event, { bubbles: true }));
}

/** Closed by its own attribute, or by a `fieldset` around it that is closed. */
const closed = (control: Element) => control.matches(':disabled');

const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password']);
/** Digits, with no run and no repeat: a name field takes it, and so does a PIN rule. */
const TYPED = '482916';

function fillFields(): void {
  for (const field of document.body.querySelectorAll<HTMLInputElement>('input')) {
    if (closed(field) || field.readOnly) continue;
    const kind = field.getAttribute('type') ?? '';
    if (TEXT_TYPES.has(kind) && field.value === '') type(field, TYPED);
    if (kind === 'number' && field.value === '') type(field, '1234');
    if (kind === 'file') {
      const file = new File(['x'], 'logo.png', { type: 'image/png' });
      Object.defineProperty(field, 'files', { value: [file], configurable: true });
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  for (const field of document.body.querySelectorAll<HTMLTextAreaElement>('textarea')) {
    if (!closed(field) && !field.readOnly && field.value === '') type(field, TYPED);
  }
}

function changeSelects(): void {
  for (const select of document.body.querySelectorAll<HTMLSelectElement>('select')) {
    if (closed(select)) continue;
    const other = [...select.options].find((o) => !o.disabled && o.value !== select.value);
    if (other) type(select, other.value);
  }
}

const openDialog = () => [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].pop();
const liveButtons = (within: ParentNode) =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !closed(b));

/**
 * Answers a dialog the way somebody who means it does: fills it, then presses
 * its LAST live button, which is where a dialog keeps its yes. Pressing its
 * buttons in order would press Cancel first, and nothing behind the dialog
 * would ever be sent.
 */
async function answerDialogs(): Promise<void> {
  if (!openDialog()) return;
  for (let depth = 0; depth < 4; depth++) {
    await settle();
    const dialog = openDialog();
    if (!dialog) return;
    await act(async () => fillFields());
    await pressAll('input[type="checkbox"], input[type="radio"]', dialog);
    const yes = liveButtons(dialog).pop();
    if (!yes) break;
    await act(async () => yes.click());
  }
  await settle();
  const left = openDialog();
  // Still open: its yes is closed, or it stays up after a refusal. Close it.
  if (left) await act(async () => liveButtons(left)[0]?.click());
}

async function pressAll(selector: string, within: ParentNode = document.body): Promise<void> {
  for (const control of [...within.querySelectorAll<HTMLButtonElement>(selector)]) {
    if (!control.isConnected || closed(control)) continue;
    await act(async () => control.click());
  }
}

async function pressEverything(rounds = 3): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await act(async () => fillFields());
    await act(async () => changeSelects());
    await pressAll('input[type="checkbox"], input[type="radio"]');
    // From the bottom of the page up, and looked for again after each press: a
    // tab at the top swaps the view, and a button under it would never be met.
    const pressed = new Set<HTMLButtonElement>();
    for (let presses = 0; presses < 300; presses++) {
      const next = liveButtons(document.body)
        .reverse()
        .find((button) => !pressed.has(button));
      if (!next) break;
      pressed.add(next);
      await act(async () => next.click());
      await answerDialogs();
    }
    await settle();
  }
}

function pathOf(url: string): string {
  return url.startsWith(API) ? url.slice(API.length) : url;
}

/** The API, for `apiRequest` and for a raw `fetch`: a read by its path, a save written down. */
function standInServer(
  answers: Record<string, unknown>,
  taken: Record<string, unknown>,
  sent: string[],
): void {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method && init.method !== 'GET') {
      const save = `${init.method} ${path}`;
      sent.push(save);
      return save in taken ? { ok: true, data: taken[save] } : REFUSAL;
    }
    if (path in answers) return { ok: true, data: answers[path] };
    throw new Error(`unexpected request ${path}`);
  });
  const rawFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(String(input));
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      sent.push(`${method} ${path}`);
      return new Response(JSON.stringify({ code: REFUSAL.code, detail: REFUSAL.detail }), {
        status: 403,
        headers: { 'content-type': 'application/problem+json' },
      });
    }
    if (path in answers) return new Response(JSON.stringify(answers[path]), { status: 200 });
    throw new Error(`unexpected request ${path}`);
  };
  vi.stubGlobal('fetch', vi.fn(rawFetch));
}

/**
 * Opens `page` on an archived Event. `reads` answers each GET by its path; a GET
 * it does not name fails the test. A save is written down and refused, as the
 * server refuses it, whether the page sends it through `apiRequest` or a raw
 * `fetch`. `taken` names the saves the server takes on an archived Event, as
 * `METHOD path`, each with its answer.
 */
export function openArchivedPage(
  page: ReactNode,
  reads: Record<string, unknown>,
  taken: Record<string, unknown> = {},
): Promise<OpenedPage> {
  // The public read disagrees on purpose: a page that took its status there would stay live.
  const published = { ...ARCHIVED_EVENT, status: 'published' };
  return openEventPage(
    page,
    { [EVENT_READ]: published, [EVENTS_READ]: [ARCHIVED_EVENT], ...reads },
    taken,
  );
}

/**
 * The same page on an Event the test describes itself: `reads` holds the Event's
 * own read, and the club's list then holds that Event. A test that names
 * `EVENTS_READ` says what the list holds.
 */
export async function openEventPage(
  page: ReactNode,
  reads: Record<string, unknown>,
  taken: Record<string, unknown> = {},
): Promise<OpenedPage> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const sent: string[] = [];
  const answers = {
    [ORG_READ]: { id: ORG_ID, name: 'Club' },
    [EVENTS_READ]: EVENT_READ in reads ? [reads[EVENT_READ]] : [],
    ...reads,
  };
  standInServer(answers, taken, sent);
  vi.stubGlobal('confirm', () => true);
  vi.stubGlobal('prompt', () => TYPED);
  // jsdom draws nothing, so it has no scroll: a page that scrolls its list would throw.
  Element.prototype.scrollTo = () => undefined;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <OrganizerEventContextProvider slug={SLUG} urlEventId={EVENT_ID}>
            {page}
          </OrganizerEventContextProvider>
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();

  return {
    writes: () => [...sent],
    pressEverything,
    settle,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
      // A page that keeps its tab in the address would open the next test on it.
      window.history.replaceState(null, '', '/');
    },
  };
}
