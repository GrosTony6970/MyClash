import { expect, type Page } from '@playwright/test';

/**
 * What the `apiRequest` seam's browser specs share.
 *
 * The seam is asserted from two identities, and they cannot live in one file:
 * the `/admin/*` screens need a platform login earned once per file, and every
 * other screen runs on the organizer session the config already applies. That
 * is `37-api-failure-seam` and `38-api-failure-seam-org` respectively.
 *
 * This module exists so the split does not become two copies. `COPY` is the
 * one that matters: it is asserted verbatim on purpose, so a silent i18n key
 * rename SHOULD red both specs — and it can only do that while there is one
 * list. The three helpers below are here for the same reason, not to save
 * lines: `expectStayedOn` in particular encodes a fact about the admin shell
 * that a second, drifting copy would eventually stop encoding.
 *
 * It is deliberately not a `.spec.ts`: the prod config's default `testMatch`
 * collects only `*.spec.ts`, so this file is imported and never run.
 */

/** `LOCALE_COOKIE` in packages/i18n/src/runtime.ts. */
export const LOCALE_COOKIE = 'mc_locale';

/**
 * Asserted verbatim, and on purpose. These are the only strings this seam can
 * put on screen, so a silent key rename SHOULD red these files — that is
 * cheaper than a test that passes against `[common.apiFailure.network]`.
 * Sources: packages/i18n/src/messages/{en,fr}/common.ts,
 *          packages/i18n/src/messages/en/{organizer,admin}.ts.
 */
export const COPY = {
  networkEn: 'Could not reach the server. Check your connection and try again.',
  networkFr: 'Serveur injoignable. Vérifiez votre connexion puis réessayez.',
  unauthenticatedEn: 'Your session has expired, or this is not yours to see. Sign in again.',
  tooManyRequestsEn: 'Too many requests. Wait a moment and retry.',
  venuesTitle: 'Venues',
  venuesLoadError: 'Could not load venues.',
  backupsTitle: 'Backup Management',
  backupsLoadError: 'Failed to load backups.',
  systemVersionsLoadError: 'Failed to load system versions.',
  systemVersionsAccessDenied: 'Access denied. Super admin required.',
  organizationsLoadError: 'Failed to load organizations',
  usersLoadError: 'Failed to load platform accounts',
  rulesetsLoadError: 'Could not load curated rulesets.',
  leaguesLoadError: 'Could not load leagues',
  clubsLoadError: 'Failed to load clubs.',
  eventsLoadError: 'Failed to load events.',
  rosterLoadError: 'Could not load the roster.',
  tournamentsLoadError: 'Failed to load tournaments.',
  loginEmailLabel: 'Email address',
  loginSendLink: 'Send login link',
  magicLinkFailed: 'Could not send a login link.',
  discoverLoadError: 'Could not load the catalog.',
  /** The prefix the schedule board reports its first bootstrap read under
   *  — `organizer.schedulePage.grid.fetchLices` is `'Lices: {message}'`. */
  scheduleFetchLicesPrefix: 'Lices:',
  tournamentNotFound: 'Tournament not found',
  tournamentLoadFailed: "This tournament couldn't be loaded",
  claimTitle: 'Confirm your profile',
  claimEmailLabel: 'Your registered email',
  claimSubmit: 'Send confirmation link',
  claimGenericError: 'Something went wrong while requesting the claim.',
  // The same three, in French. The locale test sets `mc_locale=fr` before it
  // navigates, so the form it has to fill in is French — and driving it with
  // the English strings above is why that test could never reach its assertion.
  claimTitleFr: 'Confirmez votre profil',
  claimEmailLabelFr: 'Votre e-mail enregistré',
  claimSubmitFr: 'Envoyer le lien de confirmation',
} as const;

/** What the API's exception filter actually sends (api-exception.filter.ts). */
export function problemJson(
  status: number,
  detail: string,
  /**
   * The filter's extension bag. `buildDetails` moves every key that is not
   * `statusCode`/`error`/`message`/`code` under here, which is where a
   * class-validator refusal's full field list travels — `detail` carries only
   * the first of them.
   */
  details?: Record<string, unknown>,
) {
  return {
    status,
    contentType: 'application/problem+json; charset=utf-8',
    body: JSON.stringify({
      type: 'about:blank',
      title: 'Forced by the api-failure seam specs',
      status,
      detail,
      message: detail,
      statusCode: status,
      path: '/forced',
      method: 'GET',
      timestamp: new Date().toISOString(),
      ...(details ? { details } : {}),
    }),
  };
}

/**
 * Uncaught exceptions and unhandled rejections only. Deliberately NOT every
 * console error: `OrganizerLayout` writes one on purpose as slug telemetry and
 * a refused request logs one of its own, so a spec that forbade all of them
 * would be asserting something this seam does not own.
 */
export function collectCrashes(page: Page): string[] {
  const crashes: string[] = [];
  page.on('pageerror', (error) => crashes.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && /unhandled|AbortError|TimeoutError/i.test(text)) {
      crashes.push(`console: ${text}`);
    }
  });
  return crashes;
}

/**
 * The shell's auth gate redirects AFTER first paint, so "the heading rendered"
 * is not evidence the screen is ours. Give it a beat and pin the URL.
 */
export async function expectStayedOn(page: Page, path: string) {
  await page.waitForTimeout(2_000);
  expect(new URL(page.url()).pathname, `bounced off ${path}`).toBe(path);
}
