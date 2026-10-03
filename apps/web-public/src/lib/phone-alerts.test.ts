import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserAddress,
  dropForeignAddress,
  leaveDeletedAccount,
  savedForMe,
  signOut,
  turnOffPhoneAlerts,
} from './phone-alerts';

/**
 * One browser, one alert address, one account (operator ruling 238).
 *
 * Anna turns phone alerts on at the club's laptop and signs out. Ben signs in on it. Before, the
 * browser kept Anna's address: her alerts showed while Ben used the laptop, and his settings page
 * said "Enabled". Now a sign-out takes the address out of the browser, and a personal space asks
 * the server at each visit whose the address is.
 *
 * This package's vitest does not compile TSX, so the browser steps live in a pure module, driven
 * here over a stubbed `fetch` and a stand-in browser, and the screens are read as text.
 */

const API = 'https://api.example.test';
const LAPTOP = 'https://push.example/laptop';
const fetchMock = vi.fn();
const assign = vi.fn();
const replace = vi.fn();
const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** What happened, in order: the requests that left and the browser giving its address up. */
let steps: string[];

interface Held {
  endpoint: string;
  unsubscribe: () => Promise<boolean>;
}
/** The address the stand-in browser holds now; null = none. */
let held: Held | null;

function address(endpoint: string, gives = true): Held {
  return {
    endpoint,
    unsubscribe: async () => {
      steps.push(`browser forgets ${endpoint}`);
      if (gives) held = null;
      return gives;
    },
  };
}

/** A browser with a worker registered; `getSubscription` reads what it holds at that moment. */
function browser(): void {
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => ({ pushManager: { getSubscription: async () => held } }),
    },
  });
}

/** Every request answers 200 with `body`, and is noted by its path. */
function server(body: unknown = {}, status = 200): void {
  fetchMock.mockImplementation(async (url: string) => {
    steps.push(`POST ${url.replace(`${API}/api/v1/`, '')}`);
    return answer(status, body);
  });
}

const sentBodies = () =>
  fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit).body] as const);

beforeEach(() => {
  steps = [];
  held = address(LAPTOP);
  fetchMock.mockReset();
  assign.mockReset();
  replace.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { location: { assign, replace } });
  browser();
  server();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the address this browser holds', () => {
  it('is what the registered worker holds', async () => {
    await expect(browserAddress()).resolves.toMatchObject({ endpoint: LAPTOP });
  });

  it.each<[string, unknown]>([
    [
      'no worker is registered: the settings page was never opened',
      { getRegistration: async () => undefined },
    ],
    [
      'the worker holds no address',
      { getRegistration: async () => ({ pushManager: { getSubscription: async () => null } }) },
    ],
    ['the browser has no push (a tab on an iPhone)', { getRegistration: async () => ({}) }],
    [
      'the browser refuses to say (private mode)',
      { getRegistration: async () => Promise.reject(new Error('denied')) },
    ],
    ['the browser has no worker support at all', undefined],
  ])('is none when %s', async (_, serviceWorker) => {
    vi.stubGlobal('navigator', { serviceWorker });
    await expect(browserAddress()).resolves.toBeNull();
  });
});

describe('asking the server whose the address is', () => {
  it.each([
    [true, 'yes'],
    [false, 'no'],
  ])('hands back its answer: %s', async (subscribed, saved) => {
    server({ subscribed });
    await expect(savedForMe(API, LAPTOP)).resolves.toBe(saved);
    expect(sentBodies()).toEqual([
      [`${API}/api/v1/notifications/me/subscribed`, JSON.stringify({ endpoint: LAPTOP })],
    ]);
  });

  it.each([[500], [404]])('a refusal %s is "nobody could say", never "no"', async (status) => {
    server({ detail: 'no' }, status);
    await expect(savedForMe(API, LAPTOP)).resolves.toBe('unknown');
  });

  it.each([[401], [403]])(
    'a login that is over (%s) is said as such, not as "reload"',
    async (status) => {
      server({ detail: 'no' }, status);
      await expect(savedForMe(API, LAPTOP)).resolves.toBe('signed-out');
    },
  );

  it('a request that never landed is "nobody could say"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(savedForMe(API, LAPTOP)).resolves.toBe('unknown');
  });
});

describe('the check of a personal space', () => {
  it('takes out of the browser an address that is not the account’s', async () => {
    server({ subscribed: false });
    await dropForeignAddress(API);
    expect(steps).toEqual(['POST notifications/me/subscribed', `browser forgets ${LAPTOP}`]);
  });

  it('leaves the account’s own address alone', async () => {
    server({ subscribed: true });
    await dropForeignAddress(API);
    expect(steps).toEqual(['POST notifications/me/subscribed']);
  });

  it('asks nothing in a browser that holds no address', async () => {
    held = null;
    await dropForeignAddress(API);
    expect(steps).toEqual([]);
  });

  it.each([[500], [401]])('leaves the address alone when nobody could say: %s', async (status) => {
    server({ detail: 'no' }, status);
    await dropForeignAddress(API);
    expect(steps).not.toContain(`browser forgets ${LAPTOP}`);
    expect(held).not.toBeNull();
  });

  it('leaves alone a NEW address another tab turned on while the server answered', async () => {
    fetchMock.mockImplementation(async () => {
      held = address('https://push.example/new');
      return answer(200, { subscribed: false });
    });
    await dropForeignAddress(API);
    expect(steps).toEqual([]);
    expect(held?.endpoint).toBe('https://push.example/new');
  });

  it('two callers at once share one check', async () => {
    server({ subscribed: true });
    await Promise.all([dropForeignAddress(API), dropForeignAddress(API)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again for the next account: Ben signs in with no page reload', async () => {
    server({ detail: 'signed out' }, 401);
    await dropForeignAddress(API);
    expect(held).not.toBeNull();

    fetchMock.mockReset();
    server({ subscribed: false });
    await dropForeignAddress(API);
    expect(held).toBeNull();
  });

  it('does not throw when the browser refuses to give the address up', async () => {
    held = { endpoint: LAPTOP, unsubscribe: async () => Promise.reject(new Error('no')) };
    server({ subscribed: false });
    await expect(dropForeignAddress(API)).resolves.toBeUndefined();
  });
});

describe('turning phone alerts off', () => {
  it('the browser gives the address up first, then the server is told which one', async () => {
    await expect(turnOffPhoneAlerts(API)).resolves.toBe(true);
    expect(steps).toEqual([`browser forgets ${LAPTOP}`, 'POST notifications/me/unsubscribe']);
    expect(sentBodies()).toEqual([
      [`${API}/api/v1/notifications/me/unsubscribe`, JSON.stringify({ endpoint: LAPTOP })],
    ]);
  });

  it('is off even when the server could not be told: the dead address goes at the next alert', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(turnOffPhoneAlerts(API)).resolves.toBe(true);
    expect(held).toBeNull();
  });

  it('says so when the browser kept its address', async () => {
    held = address(LAPTOP, false);
    await expect(turnOffPhoneAlerts(API)).resolves.toBe(false);
  });

  it('sends nothing from a browser that holds no address', async () => {
    held = null;
    await expect(turnOffPhoneAlerts(API)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a deleted account', () => {
  it('takes the address out of the browser, tells no server (its rows are gone), then leaves', async () => {
    replace.mockImplementation(() => steps.push('page changes'));
    await leaveDeletedAccount('/?account_deleted=1');
    expect(steps).toEqual([`browser forgets ${LAPTOP}`, 'page changes']);
    expect(replace).toHaveBeenCalledWith('/?account_deleted=1');
  });

  it('leaves at once from a browser that holds no address', async () => {
    held = null;
    await leaveDeletedAccount('/?account_deleted=1');
    expect(steps).toEqual([]);
    expect(replace).toHaveBeenCalledWith('/?account_deleted=1');
  });
});

describe('signing out', () => {
  it('the alerts first, while the login still says whose they are; then the login; then the page', async () => {
    await signOut(API, '/login');
    expect(steps).toEqual([
      `browser forgets ${LAPTOP}`,
      'POST notifications/me/unsubscribe',
      'POST auth/logout',
    ]);
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('with no alert address: the login, then the page', async () => {
    held = null;
    await signOut(API, '/');
    expect(steps).toEqual(['POST auth/logout']);
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('still leaves the page when nothing reaches the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await signOut(API, '/login');
    expect(assign).toHaveBeenCalledWith('/login');
    expect(held).toBeNull();
  });
});

describe('the wiring of the screens', () => {
  const read = (file: string) => readFileSync(join(__dirname, '..', '..', file), 'utf8');
  const DOORS: Array<[string, string]> = [
    ['app/_components/SiteHeader.tsx', "await signOut(apiUrl, '/');"],
    ['src/components/PublicPersonalShell.tsx', "await signOut(apiUrl, '/login');"],
    ['app/me/settings/SettingsClient.tsx', "await signOut(apiUrl, '/login');"],
  ];

  it.each(DOORS)('%s signs out through the one sign-out, and no other way', (file, call) => {
    const source = read(file);
    expect(source).toContain(call);
    expect(source).not.toContain('auth/logout');
  });

  it('no other screen of this app signs out by itself', () => {
    const sources = ['app', 'src'].flatMap((dir) =>
      (readdirSync(join(__dirname, '..', '..', dir), { recursive: true }) as string[])
        .map((file) => join(dir, file).replaceAll('\\', '/'))
        .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.')),
    );
    // Every source file of the app is read: a fourth door would be a second owner.
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.filter((file) => read(file).includes('auth/logout'))).toEqual([
      'src/lib/phone-alerts.ts',
    ]);
  });

  it('a personal space checks the address once the account is known', () => {
    const source = read('src/components/PublicPersonalShell.tsx');
    expect(source).toMatch(
      /setHasAdminAccess\(decision\.hasAdminAccess\);\s+\/\/ .+\s+void dropForeignAddress\(apiUrl\);\s+setReady\(true\);/,
    );
  });

  it('a deleted account takes the address out of the browser before the page changes', () => {
    const source = read('app/me/security/page.tsx');
    expect(source).toContain("await leaveDeletedAccount('/?account_deleted=1');");
    expect(source).not.toContain("window.location.replace('/?account_deleted=1')");
  });

  it('the alert settings ask the server, and say so when nobody could answer', () => {
    const source = read('app/notifications/NotificationSettingsClient.tsx');
    expect(source).toContain(
      "const saved = subscription ? await savedForMe(apiUrl, subscription.endpoint) : 'no';",
    );
    expect(source).toContain("setEnabled(saved === 'yes');");
    // A login that is over is not "reload the page": the page reads Off, and "Turn on" asks to sign in.
    expect(source).toContain("setUnchecked(saved === 'unknown');");
    expect(source).toMatch(/unchecked\s+\? t\('publicApp\.notifications\.statusUnchecked'\)/);
    // No row id is kept: it was lost at the first reload, and "Turn off" then left the address.
    expect(source).not.toContain('subscriptionId');
    expect(source).not.toContain("method: 'DELETE'");
  });

  it('"Turn on" waits for the check, then saves under the account', () => {
    const source = read('app/notifications/NotificationSettingsClient.tsx');
    expect(source).toMatch(
      /await dropForeignAddress\(apiUrl\);\s+const registration = await navigator\.serviceWorker\.ready;/,
    );
    expect(source).toContain('`${apiUrl}/api/v1/notifications/me/subscribe`');
  });

  it('"Turn off" goes through the one owner, and says so when the browser kept its address', () => {
    const source = read('app/notifications/NotificationSettingsClient.tsx');
    expect(source).toMatch(
      /if \(!\(await turnOffPhoneAlerts\(apiUrl\)\)\) \{\s+setMessage\(t\('publicApp\.notifications\.errDisable'\)\);\s+return;/,
    );
  });
});
