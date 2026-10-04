import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSignInDoor } from './sign-in-doors';

/**
 * The public site's header says who the visitor is from `/me` (operator ruling 262).
 *
 * It used to look for the login cookie in `document.cookie`. The API sets that cookie
 * httpOnly, so no page can see it: a signed-in visitor read "Sign in".
 *
 * This package's vitest does not compile TSX: the header is read as text.
 */

const source = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('isSignInDoor', () => {
  // `/reset-password`: the emailed link is a page load, the new password then signs in without one.
  it.each([['/login'], ['/reset-password'], ['/auth/oauth/callback'], ['/auth/anything']])(
    '%s is a door',
    (path) => {
      expect(isSignInDoor(path)).toBe(true);
    },
  );

  it('every page that signs in and then navigates on the client is a door', () => {
    // The pages of this app that set a login and call `router.replace`. A new one goes here
    // and in `isSignInDoor`, or the header keeps "Sign in" after its sign-in.
    for (const page of ['login', 'reset-password', 'auth/oauth/callback']) {
      expect(source(`app/${page}/page.tsx`), page).toContain('router.replace(');
      expect(isSignInDoor(`/${page}`), page).toBe(true);
    }
  });

  it.each([['/'], ['/me'], ['/login-help'], ['/e/fal-2027/home'], ['/authors'], [null], ['']])(
    '%s is not a door',
    (path) => {
      expect(isSignInDoor(path)).toBe(false);
    },
  );
});

describe('the site header', () => {
  const header = source('app/_components/SiteHeader.tsx');

  it('never reads a cookie: both login cookies are httpOnly', () => {
    expect(header).not.toContain('document.cookie.includes');
    expect(header).not.toContain('useSyncExternalStore');
  });

  it('asks /me once, and a read that failed is not a signed-out visitor', () => {
    expect(header).toMatch(
      /void fetchMe\(apiUrl, \{ signal: controller\.signal \}\)\.then\(\(result\) => \{\s+if \(!result\.ok && result\.kind === 'aborted'\) return;\s+setVisitor\(resolvePublicPersonal\(result\.ok \? result\.data : null, result\.ok\)\);/,
    );
    expect(header.match(/fetch(Me)?\(/g)).toHaveLength(1);
  });

  it('shows "Sign in" to a visitor the server calls signed out, and the account to its holder', () => {
    expect(header).toContain("{visitor?.kind === 'sign_in' && (");
    expect(header).toContain("{visitor?.kind === 'allow' && (");
    expect(header).toContain('{visitor.hasAdminAccess && (');
    expect(header).toContain("{visitor.displayName ?? t('publicApp.home.signedInFallback')}");
  });

  it('names a guest beside "Sign in", and her name opens her schedule (ruling 268)', () => {
    expect(header).toMatch(
      /\{visitor\.guest && \(\s+<NameChip href=\{visitor\.guest\.scheduleHref\}>\{visitor\.guest\.name\}<\/NameChip>\s+\)\}\s+<Link\s+href="\/login"/,
    );
    // An account's name still opens the personal space.
    expect(header).toMatch(/<NameChip href="\/me">\s+\{visitor\.displayName \?\?/);
  });

  it('is mounted again when the visitor leaves a sign-in door', () => {
    expect(source('app/_components/MaybeSiteHeader.tsx')).toContain(
      "return <SiteHeader key={isSignInDoor(path) ? 'door' : 'site'} />;",
    );
  });
});
