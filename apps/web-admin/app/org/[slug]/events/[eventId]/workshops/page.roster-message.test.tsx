import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import WorkshopsAdminPage from './page';

/**
 * The organiser messages one session's people from its roster (operator rulings 530, 532).
 *
 * Claire opens Saturday's roster and writes "We moved to Hall B". Send asks first, saying how many
 * people it goes to; then the message goes through the Workshop's one message door, named to
 * Saturday. A cancelled session's roster, and a roster with nobody booked or waiting, offer no
 * message at all; on an archived Event Send is greyed.
 *
 * The page is MOUNTED and clicked.
 */

const NAVIGATION = vi.hoisted(() => ({
  params: { slug: 'org', eventId: 'ev1' },
  router: { replace: () => undefined, push: () => undefined },
  search: new URLSearchParams(),
  eventStatus: 'running',
}));
vi.mock('next/navigation', () => ({
  useParams: () => NAVIGATION.params,
  useRouter: () => NAVIGATION.router,
  usePathname: () => '/org/org/events/ev1/workshops',
  useSearchParams: () => NAVIGATION.search,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: NAVIGATION.eventStatus }] }),
}));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('./WorkshopScheduleBoard', () => ({ WorkshopScheduleBoard: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const session = (id: string, status = 'scheduled') => ({
  id,
  startsAt: null,
  endsAt: null,
  locationLabel: null,
  venueId: null,
  areaId: null,
  venue: null,
  area: null,
  capacity: 2,
  confirmedCount: 2,
  status,
});
const workshop = (id: string, title: string, sessionId: string, status?: string) => ({
  id,
  slug: id,
  title,
  category: null,
  level: null,
  weapon: null,
  language: 'en',
  capacity: 2,
  durationMinutes: 60,
  status: 'published',
  color: null,
  coverImageUrl: null,
  venueId: null,
  venue: null,
  instructors: [],
  sessions: [session(sessionId, status)],
});

const booking = (name: string, status: string) => ({
  id: `e-${name}`,
  status,
  waitlistPosition: status === 'waitlisted' ? 1 : null,
  enrolledAt: '2026-05-01T08:00:00+00:00',
  personId: `${name}-row`,
  global_person_id: null,
  guest: false,
  persons: { id: `${name}-row`, givenName: name, familyName: 'Roux', clubs: null },
});
/** Two seats and a waiting place are counted; a refused booking is not. */
const ROSTER = [
  booking('Claire', 'confirmed'),
  booking('Tom', 'confirmed'),
  booking('Ana', 'refused'),
  booking('Zoe', 'waitlisted'),
];

let reads: Record<string, unknown>;
let notifyAnswer: unknown;

function setReads(sessionStatus = 'scheduled', roster: unknown[] = ROSTER) {
  reads = {
    '/api/v1/events/ev1': { start_date: '2026-05-01', end_date: null, timezone: 'Europe/Paris' },
    '/api/v1/events/ev1/instructors': [],
    '/api/v1/organizations/slug/org': { id: 'org-1' },
    '/api/v1/organizations/org-1/venues': [],
    '/api/v1/events/ev1/workshops': [
      workshop('w-1', 'Longsword basics', 's-1', sessionStatus),
      workshop('w-2', 'Sabre', 's-2'),
    ],
    '/api/v1/events/ev1/workshop-breaks': [],
    '/api/v1/workshop-sessions/s-1/roster': roster,
  };
}

function writes() {
  return vi
    .mocked(apiRequest)
    .mock.calls.filter(([, , init]) => init?.method && init.method !== 'GET')
    .map(([, path, init]) => ({ path, body: init!.body }));
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  NAVIGATION.eventStatus = 'running';
  setReads();
  notifyAnswer = { ok: true, data: { id: 'b-1', recipientCount: 3 } };
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method === 'POST' && path.endsWith('/notify')) return notifyAnswer as never;
    if (path in reads) return { ok: true, data: reads[path] };
    // The second Workshop's roster cannot be read.
    if (path === '/api/v1/workshop-sessions/s-2/roster') {
      return { ok: false, kind: 'network' } as never;
    }
    throw new Error(`unexpected request ${path}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openPage() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <WorkshopsAdminPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

const buttons = (label: string) =>
  [...document.body.querySelectorAll('button')].filter((b) => b.textContent === label);

async function click(button: HTMLButtonElement | undefined) {
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

/** Types into a field the way a person does, so React's onChange runs. */
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(field) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const messageBox = () =>
  [...document.body.querySelectorAll('section')].find((s) =>
    s.textContent?.includes('Message the people booked'),
  );

async function writeMessage() {
  const box = messageBox();
  expect(box, 'no message box').toBeDefined();
  await type(box!.querySelector('input')!, 'Hall B');
  await type(box!.querySelector('textarea')!, 'We moved to Hall B.');
  return box!;
}

const sendIn = (box: Element) =>
  [...box.querySelectorAll('button')].find((b) => b.textContent === 'Send');

describe("a message from a session's roster", () => {
  it('asks first, counting seats and waiting list, then sends to that session only', async () => {
    await openPage();
    await click(buttons('Roster')[0]);
    const box = await writeMessage();
    await click(sendIn(box));

    expect(writes()).toEqual([]);
    expect(document.body.textContent).toContain('Send "Hall B"?');
    expect(document.body.textContent).toContain('booked or waiting in this session: 3.');

    // The question's own Send is the last one on the screen.
    await click(buttons('Send').at(-1));

    expect(writes()).toEqual([
      {
        path: '/api/v1/workshops/w-1/notify',
        body: { title: 'Hall B', body: 'We moved to Hall B.', sessionId: 's-1' },
      },
    ]);
    expect(document.body.textContent).toContain('Sent. People reached: 3.');
    expect(box.querySelector('input')!.value).toBe('');
  });

  it('sends nothing when the question is answered "Cancel"', async () => {
    await openPage();
    await click(buttons('Roster')[0]);
    await click(sendIn(await writeMessage()));
    await click(buttons('Cancel').at(-1));

    expect(writes()).toEqual([]);
  });

  it("says in the reader's words that the session was cancelled meanwhile", async () => {
    notifyAnswer = {
      ok: false,
      kind: 'http',
      status: 409,
      code: 'WORKSHOP_SESSION_CANCELLED',
      detail: 'This workshop session was cancelled.',
      details: null,
      validationErrors: null,
    };
    await openPage();
    await click(buttons('Roster')[0]);
    await click(sendIn(await writeMessage()));
    await click(buttons('Send').at(-1));

    expect(document.body.textContent).toContain(
      'This session was cancelled: its people are not messaged.',
    );
  });

  it('is not offered on a cancelled session: it does nothing (532)', async () => {
    setReads('cancelled');
    await openPage();
    await click(buttons('Roster')[0]);

    expect(document.body.textContent).toContain('Tom Roux');
    expect(messageBox()).toBeUndefined();
  });

  it('is not offered when nobody is booked or waiting', async () => {
    setReads('scheduled', [booking('Ana', 'refused')]);
    await openPage();
    await click(buttons('Roster')[0]);

    expect(document.body.textContent).toContain('Ana Roux');
    expect(messageBox()).toBeUndefined();
  });

  it('greys Send on an archived Event', async () => {
    NAVIGATION.eventStatus = 'archived';
    await openPage();
    await click(buttons('Roster')[0]);
    const box = await writeMessage();

    expect(sendIn(box)!.disabled).toBe(true);
  });

  it("does not show another session's people when a roster cannot be read", async () => {
    await openPage();
    await click(buttons('Roster')[0]);
    expect(document.body.textContent).toContain('Tom Roux');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();

    await click(buttons('Roster')[1]);

    expect(document.body.textContent).not.toContain('Tom Roux');
    expect(messageBox()).toBeUndefined();
  });
});
