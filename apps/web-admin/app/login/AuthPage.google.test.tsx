import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@myclash/i18n';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AuthPage } from './AuthPage';

/**
 * Google is off in production. An organiser who tapped "Continue with Google" landed on the
 * sign-in server's bare "provider is not enabled" page (ruling 495). The page now asks the
 * sign-in server once, and shows the button on a yes only, on every tab and step.
 */

vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));

const SETTINGS = 'https://app.myclash.test/auth/v1/settings';
const GOOGLE = en.auth.oauth.continueWithGoogle;

let container: HTMLDivElement;
let root: Root;
let fetched: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;

/** The sign-in server's answer; every other read gets an empty 200. */
function googleSays(google: boolean | 'never') {
  fetched.mockImplementation(async (url: string) => {
    if (url !== SETTINGS) return new Response('{}');
    if (google === 'never') return new Promise<Response>(() => undefined);
    return new Response(JSON.stringify({ external: { email: true, google } }));
  });
}

async function open(tab: 'signin' | 'signup') {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <AuthPage initialTab={tab} />
      </I18nProvider>,
    );
  });
}

async function press(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  )!;
  await act(async () => button.click());
}

const shown = () => container.textContent ?? '';
/** The "or" between the main action and the other ways in (an `AuthDivider`). */
const divided = () => [...container.querySelectorAll('span')].some((s) => s.textContent === 'or');
const asked = () => fetched.mock.calls.filter(([url]) => url === SETTINGS).length;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://app.myclash.test');
  fetched = vi.fn();
  vi.stubGlobal('fetch', fetched);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the Google button on the admin sign-in page', () => {
  it('shows when the sign-in server says Google is on, after asking it', async () => {
    googleSays(true);
    await open('signin');

    expect(fetched).toHaveBeenCalledWith(SETTINGS, { credentials: 'omit' });
    expect(shown()).toContain(GOOGLE);
    expect(shown()).toContain(en.auth.login.sendLoginLink);
  });

  it('is not shown while the question is on its way', async () => {
    googleSays('never');
    await open('signin');

    expect(asked()).toBe(1);
    expect(shown()).not.toContain(GOOGLE);
  });

  it('is gone while Google is off; the "or" and the email link stay', async () => {
    googleSays(false);
    await open('signin');

    expect(shown()).not.toContain(GOOGLE);
    expect(divided()).toBe(true);
    expect(shown()).toContain(en.auth.login.sendLoginLink);
  });

  it('takes the "or" with it on sign-up, where Google is the only other way', async () => {
    googleSays(false);
    await open('signup');

    expect(shown()).not.toContain(GOOGLE);
    expect(divided()).toBe(false);
  });

  it('shows on sign-up, under its "or", when Google is on', async () => {
    googleSays(true);
    await open('signup');

    expect(divided()).toBe(true);
    expect(shown()).toContain(GOOGLE);
  });

  // The reset form replaces the other ways in, so coming back draws them again: asked there, the
  // button hid until a second answer came.
  it('asks once, and shows the button at once, back from the reset form and across the tabs', async () => {
    googleSays(true);
    await open('signin');
    await press(en.auth.login.forgotPassword);
    expect(shown()).not.toContain(GOOGLE);
    googleSays('never');
    await press(en.auth.login.backToSignIn);
    expect(shown()).toContain(GOOGLE);
    await press(en.auth.login.tabSignUp);
    expect(shown()).toContain(GOOGLE);

    expect(asked()).toBe(1);
  });
});
