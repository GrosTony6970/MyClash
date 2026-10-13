import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterSignIn, loginHref, signInAgainHere } from './sign-in-return';

describe('loginHref', () => {
  it('carries the page the door is on', () => {
    expect(loginHref('/e/open-2027/my-schedule')).toBe(
      '/login?next=%2Fe%2Fopen-2027%2Fmy-schedule',
    );
  });

  it('keeps a query of that page whole', () => {
    const href = loginHref('/e/open-2027/live?lice=l-1');
    expect(new URL(href, 'https://x.test').searchParams.get('next')).toBe(
      '/e/open-2027/live?lice=l-1',
    );
  });

  it('carries nothing from a sign-in page, or from no page', () => {
    expect(loginHref('/login')).toBe('/login');
    expect(loginHref('/login?refused=link_expired')).toBe('/login');
    expect(loginHref('/reset-password')).toBe('/login');
    expect(loginHref('/auth/oauth/callback')).toBe('/login');
    expect(loginHref(null)).toBe('/login');
    expect(loginHref(undefined)).toBe('/login');
  });

  it('carries nothing that is not a path of our own site', () => {
    expect(loginHref('//other-site.test/x')).toBe('/login');
    expect(loginHref('https://other-site.test/x')).toBe('/login');
  });

  it("carries nothing from the site's home: it is no page to return to", () => {
    expect(loginHref('/')).toBe('/login');
    expect(loginHref('/?account_deleted=1')).toBe('/login');
  });
});

describe('afterSignIn', () => {
  it('returns to the page the sign-in page was given', () => {
    expect(afterSignIn('/e/open-2027/my-schedule')).toBe('/e/open-2027/my-schedule');
    expect(afterSignIn('/o/lyon-hema')).toBe('/o/lyon-hema');
  });

  it("lands on the visitor's own space when no page was given", () => {
    expect(afterSignIn(undefined)).toBe('/me');
    expect(afterSignIn(null)).toBe('/me');
    expect(afterSignIn('')).toBe('/me');
  });

  it('never leaves our site, whatever the address says', () => {
    expect(afterSignIn('//other-site.test')).toBe('/me');
    expect(afterSignIn('/\\other-site.test')).toBe('/me');
    expect(afterSignIn('https://other-site.test/me')).toBe('/me');
    expect(afterSignIn('javascript:alert(1)')).toBe('/me');
    expect(afterSignIn('e/open-2027')).toBe('/me');
  });

  // The API's mailed link and Google read `/` as "no page given" and land on
  // the personal space: the password sign-in lands there too.
  it("lands on the personal space when the page given is the site's home", () => {
    expect(afterSignIn('/')).toBe('/me');
    expect(afterSignIn('/?x=1')).toBe('/me');
  });

  it('never returns to a sign-in page', () => {
    expect(afterSignIn('/login')).toBe('/me');
    expect(afterSignIn('/login?next=/login')).toBe('/me');
    expect(afterSignIn('/auth/oauth/callback?code=x')).toBe('/me');
  });

  it('reads the first value when the address repeats the parameter', () => {
    expect(afterSignIn(['/o/lyon-hema', '//other-site.test'])).toBe('/o/lyon-hema');
    expect(afterSignIn(['//other-site.test', '/o/lyon-hema'])).toBe('/me');
  });

  it('agrees with loginHref: what a door sends is what sign-in returns to', () => {
    const from = '/e/open-2027/people/p-1';
    const next = new URL(loginHref(from), 'https://x.test').searchParams.get('next');
    expect(afterSignIn(next)).toBe(from);
  });
});

describe('signInAgainHere', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves for the sign-in page, which returns to the page it left', () => {
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/me/instructor', replace } });

    signInAgainHere();

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fme%2Finstructor');
  });
});

/**
 * web-public's vitest compiles no TSX: the doors and the sign-in page are read
 * as text. `tests/a11y/public-login.spec.ts` signs in through the page.
 */
describe('every door asks loginHref, and sign-in lands by afterSignIn', () => {
  const root = join(__dirname, '..', '..');
  const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');
  const event = ['app', 'e', '[eventSlug]'];

  it.each([
    ['the site header', ['app', '_components', 'SiteHeader.tsx'], 'loginHref(here)'],
    ['follow an organiser', ['app', '_components', 'FollowOrganizerButton.tsx'], 'loginHref(`/o/'],
    [
      'the guest schedule',
      [...event, 'my-schedule', 'ScheduleNotShown.tsx'],
      'loginHref(`/e/${eventSlug}/my-schedule`)',
    ],
    ["a person's page", [...event, 'people', '[personId]', 'ThisIsMeCard.tsx'], 'loginHref(here)'],
    [
      'a Workshop page',
      [...event, 'w', '[workshopSlug]', 'WorkshopPageParts.tsx'],
      'loginHref(here)',
    ],
    ['the personal space', ['src', 'components', 'PublicPersonalShell.tsx'], 'signInAgainHere();'],
    ['its dashboard', ['app', 'me', 'PersonalSpaceDashboard.tsx'], 'signInAgainHere();'],
    [
      'its instructor page',
      ['app', 'me', 'instructor', 'InstructorDashboard.tsx'],
      'signInAgainHere();',
    ],
    ['its security page', ['app', 'me', 'security', 'page.tsx'], 'signInAgainHere();'],
    [
      'its data export',
      ['app', 'me', 'security', 'DataAndPrivacySection.tsx'],
      'signInAgainHere();',
    ],
  ])('%s', (_name, path, call) => {
    expect(read(...path)).toContain(call);
  });

  /**
   * A sweep, not a list of doors: a new door written with the bare address
   * turns this red. The files below may name the sign-in address, each for a
   * reason that is not "a door that should return".
   */
  it('no other file of the app names the sign-in address', () => {
    const MAY_NAME_IT = [
      // The rule's own two files, and the crawler's list.
      'src/lib/sign-in-return.ts',
      'src/lib/sign-in-doors.ts',
      'app/robots-rules.ts',
      // Where a sign-OUT lands: there is no page to return to.
      'src/components/PublicPersonalShell.tsx',
      'app/me/settings/SettingsClient.tsx',
      // After a failed sign-in, a changed password or a new one: a fresh sign-in.
      'app/auth/oauth/callback/page.tsx',
      'app/me/security/PasswordChangedNotice.tsx',
      'app/me/security/SessionEnded.tsx',
      'app/reset-password/SignInWithNewPassword.tsx',
    ];
    const named: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/['"`]\/login['"`?]/.test(read(path))) named.push(path);
        }
      }
    };
    walk('app');
    walk('src');
    expect(named.sort()).toEqual([...MAY_NAME_IT].sort());
  });

  it('the sign-in page reads `next` once, and every way in uses it', () => {
    const page = read('app', 'login', 'page.tsx');
    expect(page).toContain("const landing = afterSignIn(use(searchParams)['next']);");
    expect(page).toContain('router.replace(landing);');
    expect(page).toContain('requestMagicLink(apiUrl, email, landing)');
    expect(page).toContain('startGoogleSignIn(window.location.origin, landing)');
    expect(page).not.toContain("'/me'");
  });

  it('the requests carry the landing they are handed, and no address of their own', () => {
    const requests = read('app', 'login', 'auth-requests.ts');
    expect(requests).toContain("type: 'public_login', redirectTo: landing }");
    expect(requests).toContain('const next = encodeURIComponent(landing);');
    expect(requests).not.toContain("'/me'");
  });

  it('the OAuth return falls back on a path of our own site only', () => {
    const callback = read('app', 'auth', 'oauth', 'callback', 'page.tsx');
    expect(callback).toContain("isOwnSitePath(asked) ? asked : mode === 'public_login'");
    expect(callback).not.toContain("searchParams.get('next') ??");
  });
});
