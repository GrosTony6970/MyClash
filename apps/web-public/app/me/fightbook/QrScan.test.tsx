// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type * as UiScan from '@myclash/ui/scan';
import type { FightBookEvent } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { signInAgainHere } from '../../../src/lib/sign-in-return';
import { QrTools } from './QrTools';

/**
 * "Scan a FightBook QR": the form is filled first (weapons, then this Event or a place), the camera
 * opens after, the first `fb:` code it reads is sent at once, and the camera stops. The camera is a
 * double that the test feeds codes to: it reads one every 4 s, as the real one does.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('../../../src/lib/sign-in-return', () => ({ signInAgainHere: vi.fn() }));
const camera = vi.hoisted(() => ({
  active: false,
  onToken: (_token: string) => undefined as void,
  error: null as null | 'denied',
}));
vi.mock('@myclash/ui/scan', async (importOriginal) => ({
  ...(await importOriginal<typeof UiScan>()),
  useCameraScanner: (active: boolean, onToken: (token: string) => void) => {
    camera.active = active;
    camera.onToken = onToken;
    return { videoRef: { current: null }, canvasRef: { current: null }, error: camera.error };
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCAN = 'POST /api/v1/me/fightbook/qr/scan';
const EVENT = '11111111-1111-4111-8111-111111111111';
const eventOf = (id: string, name: string, today: string | null): FightBookEvent => ({
  id,
  name,
  days: ['2026-11-13'],
  today,
  freeUntil: null,
});
const TODAY = eventOf(EVENT, 'Probe Open', '2026-11-13');
const LATER = eventOf('22222222-2222-4222-8222-222222222222', 'Probe Later', null);

// The scan view is a lazy view; load it once up front so each test opens it in one tick.
beforeAll(() => import('./QrScan'));

let container: HTMLDivElement;
let root: Root;
let posts: Array<{ path: string; body: Record<string, unknown> }>;
let answer: () => unknown;
let onSent: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  posts = [];
  camera.active = false;
  camera.error = null;
  onSent = vi.fn();
  answer = () => ({ ok: true, data: { id: 'r1' } });
  vi.mocked(apiRequest).mockImplementation((async (
    _base: string,
    path: string,
    init?: RequestInit & { body?: unknown },
  ) => {
    if (`${init?.method ?? 'GET'} ${path}` !== SCAN) throw new Error(`unexpected ${path}`);
    posts.push({ path, body: init?.body as Record<string, unknown> });
    return answer();
  }) as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  vi.mocked(signInAgainHere).mockReset();
});

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
async function click(el: Element | null | undefined) {
  await act(async () => (el as HTMLElement).click());
  await settled();
}
async function change(el: Element | null, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
const read = (token: string) => act(async () => camera.onToken(token));

async function openScan(events: FightBookEvent[] = [TODAY, LATER]) {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <QrTools
          apiUrl="http://api.test"
          events={events}
          catalog={['Longsword', 'Sabre']}
          onSent={onSent}
        />
      </I18nProvider>,
    ),
  );
  await click(button('Scan a FightBook QR'));
}
const tick = (name: string) =>
  [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (i) => i.parentElement?.textContent === name,
  );
async function fillAndStart(weapon = 'Sabre') {
  await click(tick(weapon));
  await click(button('Start the camera'));
}

describe('the form comes first', () => {
  it('opens no camera until the weapons are chosen and the camera is asked for', async () => {
    await openScan();
    expect(camera.active).toBe(false);
    expect((button('Start the camera') as HTMLButtonElement).disabled).toBe(true);
    await click(tick('Longsword'));
    expect((button('Start the camera') as HTMLButtonElement).disabled).toBe(false);
    expect(camera.active).toBe(false);
    await click(button('Start the camera'));
    expect(camera.active).toBe(true);
  });

  it("offers today's Events and Somewhere else, never an Event with no day today", async () => {
    await openScan();
    const options = [...container.querySelectorAll('select option')].map((o) => o.textContent);
    expect(options).toEqual(['Probe Open', 'Somewhere else']);
  });

  it('needs a place for Somewhere else', async () => {
    await openScan();
    await click(tick('Sabre'));
    await change(container.querySelector('select'), '');
    expect((button('Start the camera') as HTMLButtonElement).disabled).toBe(true);
    await change(container.querySelector('input[type="text"]'), 'Hall B');
    expect((button('Start the camera') as HTMLButtonElement).disabled).toBe(false);
  });

  it('with no Event today, there is only Somewhere else', async () => {
    await openScan([LATER]);
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('input[type="text"]')).not.toBeNull();
  });
});

describe('the scan', () => {
  it('sends the first fb: code at once, with the Event and no place', async () => {
    await openScan();
    await fillAndStart('Sabre');
    await read('fb:CODE1');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.path).toBe('/api/v1/me/fightbook/qr/scan');
    expect(posts[0]?.body).toEqual({ code: 'fb:CODE1', weapons: ['Sabre'], eventId: EVENT });
  });

  it('sends a place and the phone zone for Somewhere else, and no eventId', async () => {
    await openScan();
    await click(tick('Longsword'));
    await click(tick('Sabre'));
    await change(container.querySelector('select'), '');
    await change(container.querySelector('input[type="text"]'), ' Hall B ');
    await click(button('Start the camera'));
    await read('fb:CODE1');
    expect(posts[0]?.body).toEqual({
      code: 'fb:CODE1',
      weapons: ['Longsword', 'Sabre'],
      place: 'Hall B',
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it('ignores a payload that does not start with fb:', async () => {
    await openScan();
    await fillAndStart();
    await read('https://example.test/not-ours');
    await read('0123456789abcdef');
    expect(posts).toHaveLength(0);
    expect(camera.active).toBe(true);
  });

  it('stops the camera after that submit; a payload re-read 4 s later sends nothing', async () => {
    await openScan();
    await fillAndStart();
    await read('fb:CODE1');
    expect(camera.active).toBe(false);
    await read('fb:CODE1');
    await read('fb:CODE2');
    expect(posts).toHaveLength(1);
  });

  it('two codes in the same frame send one', async () => {
    await openScan();
    await fillAndStart();
    await act(async () => {
      camera.onToken('fb:CODE1');
      camera.onToken('fb:CODE2');
    });
    expect(posts).toHaveLength(1);
  });

  it('says "Sent — they confirm on their phone" and tells the page', async () => {
    await openScan();
    await fillAndStart();
    await read('fb:CODE1');
    expect(text()).toContain('Sent — they confirm on their phone');
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(button('Scan again')).toBeUndefined();
  });
});

describe('a refusal', () => {
  it.each([
    ['bad_code', 'This code has expired or was already used — ask them to show it again'],
    ['already_asked', 'You already asked this fighter'],
    ['you_blocked', 'You blocked this fighter'],
    ['not_on_fightbook', 'This fighter does not use FightBook'],
    ['fightbook_off', 'Switch FightBook on first'],
    ['bad_event', 'A spar can only name a public Event you are at'],
    ['bad_place', 'Pick a place for a free date'],
  ])('%s shows its sentence and "Scan again"', async (code, sentence) => {
    answer = () => ({ ok: false, kind: 'http', status: 400, code });
    await openScan();
    await fillAndStart();
    await read('fb:CODE1');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(sentence);
    expect(camera.active).toBe(false);
    expect(onSent).not.toHaveBeenCalled();
    await click(button('Scan again'));
    expect(camera.active).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await read('fb:CODE2');
    expect(posts).toHaveLength(2);
  });

  it('a 429 says the hour is used up', async () => {
    answer = () => ({ ok: false, kind: 'http', status: 429, code: null });
    await openScan();
    await fillAndStart();
    await read('fb:CODE1');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'You scanned many codes',
    );
    expect(button('Scan again')).toBeDefined();
  });

  it('a 401 sends the fighter to sign in again', async () => {
    answer = () => ({ ok: false, kind: 'unauthenticated', status: 401, code: null });
    await openScan();
    await fillAndStart();
    await read('fb:CODE1');
    expect(signInAgainHere).toHaveBeenCalledTimes(1);
  });
});

describe('the camera', () => {
  it('shows the common.scan sentence for a camera error', async () => {
    camera.error = 'denied';
    await openScan();
    await fillAndStart();
    expect(text()).toContain('Camera access was refused');
  });
});
