// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../i18n/I18nProvider';
import { AskToSpar } from './AskToSpar';

/**
 * Julie asks Marc for a spar. At an Event she is on, or on a free date. A refusal is said and the
 * dialog stays open; a sent request says so and tells the page.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const EVENTS = [
  { id: EVENT_A, name: 'Open Alpha', days: ['2026-11-14', '2026-11-15'], today: null },
  { id: EVENT_B, name: 'Open Beta', days: ['2026-12-05'], today: null },
];
const WEAPONS = [
  { id: 'w1', name: 'Longsword' },
  { id: 'w2', name: 'Rapier' },
];
type Answer = { ok: boolean; data?: unknown; kind?: string; status?: number; code?: string | null };

let container: HTMLDivElement;
let root: Root;
let onSent: ReturnType<typeof vi.fn>;
let weaponRows = WEAPONS;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSent = vi.fn();
  weaponRows = WEAPONS;
});
afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
});

function serve(events: unknown, post: Answer = { ok: true, data: { id: 'r-1' } }) {
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    if (init?.method === 'POST') return post as never;
    if (path === '/api/v1/me/fightbook/events') return { ok: true, data: events } as never;
    if (path === '/api/v1/weapons?active=true') return { ok: true, data: weaponRows } as never;
    throw new Error(`unexpected request ${path}`);
  });
}

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function openDialog(eventId?: string) {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <AskToSpar
          receiverGlobalPersonId={MARC}
          name="Marc Probe"
          eventId={eventId}
          apiUrl="http://api.test"
          onSent={onSent}
        />
      </I18nProvider>,
    ),
  );
  await act(async () => container.querySelector('button')!.click());
  await settled();
}

const dialog = () => document.body.querySelector('[role="dialog"]')!;
const submit = () =>
  [...dialog().querySelectorAll('button')].find((b) => b.textContent === 'Send the request')!;
const tick = (name: string) =>
  act(async () =>
    [...dialog().querySelectorAll('label')]
      .find((l) => l.textContent === name)!
      .querySelector('input')!
      .click(),
  );
function type(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  return act(async () => {
    const proto = Object.getPrototypeOf(control) as object;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(control, value);
    control.dispatchEvent(
      new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
    );
  });
}
const posted = () =>
  vi.mocked(apiRequest).mock.calls.find((c) => c[2]?.method === 'POST')?.[2]?.body;

describe('AskSparDialog', () => {
  it('posts an Event spar with only the keys that have a value', async () => {
    serve(EVENTS);
    await openDialog();
    expect(dialog().textContent).toContain('Ask Marc Probe to spar');
    await tick('Longsword');
    await act(async () => submit().click());
    await settled();
    expect(posted()).toEqual({
      receiverGlobalPersonId: MARC,
      kind: 'event',
      eventId: EVENT_A,
      day: '2026-11-14',
      weapons: ['Longsword'],
    });
    expect(Object.keys(posted() as object)).not.toContain('time');
    expect(Object.keys(posted() as object)).not.toContain('message');
    expect(dialog().textContent).toContain('Request sent');
    expect(dialog().querySelector('a[href="/me/fightbook?tab=spars"]')).not.toBeNull();
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('posts a free date with the place and the browser zone, and no Event', async () => {
    serve(EVENTS);
    await openDialog();
    await act(async () =>
      [...dialog().querySelectorAll('input[type="radio"]')][1]!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      ),
    );
    await type(dialog().querySelector('input[type="date"]')!, '2026-12-24');
    await type(dialog().querySelector('input[type="text"]')!, 'Salle Voltaire');
    await type(dialog().querySelector('input[type="time"]')!, '18:30');
    await type(dialog().querySelector('textarea')!, ' Un petit assaut ');
    await tick('Rapier');
    await act(async () => submit().click());
    await settled();
    expect(posted()).toEqual({
      receiverGlobalPersonId: MARC,
      kind: 'free',
      day: '2026-12-24',
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      place: 'Salle Voltaire',
      time: '18:30',
      message: 'Un petit assaut',
      weapons: ['Rapier'],
    });
  });

  it('offers no Event choice when she is on no Event', async () => {
    serve([]);
    await openDialog();
    expect(dialog().querySelector('input[type="radio"]')).toBeNull();
    expect(dialog().querySelector('input[type="date"]')).not.toBeNull();
  });

  it('says her Events could not be loaded, and still lets her ask for a free date', async () => {
    vi.mocked(apiRequest).mockImplementation(async (_base, path) => {
      if (path === '/api/v1/weapons?active=true') return { ok: true, data: WEAPONS } as never;
      return { ok: false, kind: 'network' } as never;
    });
    await openDialog();
    expect(dialog().textContent).toContain('Your Events could not be loaded.');
    expect(dialog().querySelector('input[type="radio"]')).toBeNull();
    expect(dialog().querySelector('input[type="date"]')).not.toBeNull();
  });

  it('says nothing about Events when she is simply on none', async () => {
    serve([]);
    await openDialog();
    expect(dialog().textContent).not.toContain('could not be loaded');
  });

  it('preselects the Event she is looking at when she is on it', async () => {
    serve(EVENTS);
    await openDialog(EVENT_B);
    const selects = dialog().querySelectorAll('select');
    expect(selects[0]!.value).toBe(EVENT_B);
    expect(selects[1]!.value).toBe('2026-12-05');
    await tick('Rapier');
    await act(async () => submit().click());
    await settled();
    expect(posted()).toMatchObject({ eventId: EVENT_B, day: '2026-12-05' });
  });

  it('keeps Send disabled until a weapon is ticked, and while sending', async () => {
    let finish: (a: Answer) => void = () => undefined;
    vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
      if (init?.method === 'POST') return new Promise<Answer>((r) => (finish = r)) as never;
      if (path === '/api/v1/weapons?active=true') return { ok: true, data: WEAPONS } as never;
      return { ok: true, data: EVENTS } as never;
    });
    await openDialog();
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    await tick('Longsword');
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
    await act(async () => submit().click());
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ ok: true, data: { id: 'r-1' } }));
    await settled();
    expect(dialog().textContent).toContain('Request sent');
  });

  it('says the refusal and stays open when Marc switched FightBook off', async () => {
    serve(EVENTS, { ok: false, kind: 'unauthenticated', status: 403, code: 'not_on_fightbook' });
    await openDialog();
    await tick('Longsword');
    await act(async () => submit().click());
    await settled();
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'This fighter does not use FightBook.',
    );
    expect(dialog().textContent).not.toContain('Request sent');
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
    expect(onSent).not.toHaveBeenCalled();
  });

  it('defaults to the Event day that has started when the Event has one', async () => {
    serve([{ ...EVENTS[0]!, today: '2026-11-15' }]);
    await openDialog();
    expect(dialog().querySelectorAll('select')[1]!.value).toBe('2026-11-15');
    await tick('Longsword');
    await act(async () => submit().click());
    await settled();
    expect(posted()).toMatchObject({ day: '2026-11-15' });
  });

  it('preselects the first Event when the one she looks at is not hers', async () => {
    serve(EVENTS);
    await openDialog('33333333-3333-4333-8333-333333333333');
    expect(dialog().querySelectorAll('select')[0]!.value).toBe(EVENT_A);
  });

  it('keeps Send disabled on a free date with no place', async () => {
    serve([]);
    await openDialog();
    await tick('Longsword');
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    await type(dialog().querySelector('input[type="text"]')!, '  ');
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    await type(dialog().querySelector('input[type="text"]')!, 'Salle Voltaire');
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
  });

  it('lets her tick five weapons and no sixth', async () => {
    weaponRows = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ id: name, name }));
    serve([]);
    await openDialog();
    for (const name of ['A', 'B', 'C', 'D', 'E']) await tick(name);
    const sixth = [...dialog().querySelectorAll('label')]
      .find((l) => l.textContent === 'F')!
      .querySelector('input')!;
    expect(sixth.disabled).toBe(true);
    const fifth = [...dialog().querySelectorAll('label')]
      .find((l) => l.textContent === 'E')!
      .querySelector('input')!;
    expect(fifth.disabled).toBe(false);
  });

  it('says it is loading while the Events and the weapons are read', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => undefined));
    await openDialog();
    expect(dialog().textContent).toContain('Loading…');
    expect(dialog().querySelector('input')).toBeNull();
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts a free date on her local day, not the UTC day', async () => {
    const zone = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      // 11:30 UTC on the 12th is 00:30 on the 13th in Auckland.
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-12T11:30:00Z') });
      serve([]);
      await openDialog();
      const date = dialog().querySelector<HTMLInputElement>('input[type="date"]')!;
      expect(date.value).toBe('2026-11-13');
      expect(date.min).toBe('2026-11-13');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});
