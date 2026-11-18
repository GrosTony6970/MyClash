import { expect, type Browser, type BrowserContext } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';

/**
 * The two personal accounts the fighter-side specs sign in as (`46`, `47`).
 *
 * Every other spec runs as the organisation's owner. A fighter-side feature —
 * joining an Event by oneself, FightBook — needs a PERSONAL account holding a
 * claimed fighter profile, and FightBook needs two of them. The operator
 * provisions them once: two accounts, each with its claim on a fighter profile
 * approved, neither a member of the E2E organisation, neither a platform role.
 *
 *   E2E_FIGHTER_A_EMAIL / E2E_FIGHTER_A_PASSWORD
 *   E2E_FIGHTER_B_EMAIL / E2E_FIGHTER_B_PASSWORD
 *
 * Without all four the specs skip, naming them. Password login is throttled
 * per email (10 an hour), so each spec signs each account in once.
 *
 * Notices: FightBook sends real push/email notices to these two accounts
 * (a request, a yes, "we sparred"), through the worker. They are the operator's
 * own test accounts, so nothing reaches a stranger.
 */
export interface FighterLogin {
  label: 'A' | 'B';
  email: string;
  password: string;
}

export const FIGHTER_LOGINS: readonly FighterLogin[] = (['A', 'B'] as const).flatMap((label) => {
  const email = process.env[`E2E_FIGHTER_${label}_EMAIL`] ?? '';
  const password = process.env[`E2E_FIGHTER_${label}_PASSWORD`] ?? '';
  return email && password ? [{ label, email, password }] : [];
});

/** Why a fighter-side spec skips, or null when both accounts are set. */
export const FIGHTERS_MISSING: string | null =
  FIGHTER_LOGINS.length === 2
    ? null
    : 'set E2E_FIGHTER_A_EMAIL/PASSWORD and E2E_FIGHTER_B_EMAIL/PASSWORD: two personal accounts, ' +
      'each with an approved claim on a fighter profile (see tests/e2e/_fighters.ts)';

export interface Fighter {
  label: 'A' | 'B';
  /** A browser context holding only this account's login. */
  context: BrowserContext;
  /** The API as this account, sharing the context's cookie jar. */
  api: Api;
  /** The claimed profile: `global_persons.id`. */
  globalPersonId: string;
  displayName: string;
}

/**
 * Sign one fighter in, in a context of its own with NO organizer cookie.
 *
 * `storageState: undefined` is load-bearing: the config applies the organizer's
 * session to every context, and an organizer cookie beside the fighter's would
 * make each refusal below pass or fail for the wrong account.
 */
export async function signInFighter(browser: Browser, login: FighterLogin): Promise<Fighter> {
  const context = await browser.newContext({
    baseURL: runContext().baseURL,
    storageState: undefined,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
  });
  const api = apiFor(context.request);
  await api.ok(
    await api.post('auth/password-login', {
      data: { email: login.email, password: login.password },
    }),
  );
  const space = await api.json<{
    profiles: { globalPerson: { id: string; display_name: string | null } | null };
  }>(await api.get('me/personal-space'));
  const profile = space.profiles.globalPerson;
  expect(
    profile,
    `fighter ${login.label} (${login.email}) holds no claimed fighter profile — approve its claim first`,
  ).not.toBeNull();
  return {
    label: login.label,
    context,
    api,
    globalPersonId: profile!.id,
    displayName: profile!.display_name ?? '',
  };
}

/** The public site's host. The login cookie is scoped to the parent domain, so it rides along. */
export const publicBase = (process.env.E2E_PUBLIC_URL ?? 'https://app.myclash.fr').replace(
  /\/$/,
  '',
);
