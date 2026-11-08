import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlternativeMethods } from './signin-forms';

/**
 * Google is off in production. An organiser who tapped "Continue with Google" landed on the
 * sign-in server's bare "provider is not enabled" page (ruling 495). The button now asks the
 * sign-in server first, and shows on a yes only.
 */

let container: HTMLDivElement;
let root: Root;
let settings: ReturnType<typeof vi.fn>;

function googleSays(google: boolean) {
  settings.mockResolvedValue(new Response(JSON.stringify({ external: { email: true, google } })));
}

async function render(mode: 'signin' | 'signup') {
  await act(async () => {
    root.render(
      <AlternativeMethods
        t={(key) => key}
        mode={mode}
        email="sam@club.test"
        loadingAction={null}
        onMagicLink={() => undefined}
        onGoogle={() => undefined}
      />,
    );
  });
}

const shown = () => container.textContent ?? '';

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://app.myclash.test');
  settings = vi.fn();
  vi.stubGlobal('fetch', settings);
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
    await render('signin');

    expect(settings).toHaveBeenCalledWith('https://app.myclash.test/auth/v1/settings', {
      credentials: 'omit',
    });
    expect(shown()).toContain('auth.oauth.continueWithGoogle');
    expect(shown()).toContain('auth.login.sendLoginLink');
  });

  it('is not shown while the question is on its way', async () => {
    settings.mockReturnValue(new Promise(() => undefined));
    await render('signin');

    expect(settings).toHaveBeenCalledOnce();
    expect(shown()).not.toContain('auth.oauth.continueWithGoogle');
  });

  it('is gone while Google is off; the email link stays', async () => {
    googleSays(false);
    await render('signin');

    expect(shown()).not.toContain('auth.oauth.continueWithGoogle');
    expect(shown()).toContain('auth.login.or');
    expect(shown()).toContain('auth.login.sendLoginLink');
  });

  it('takes the "or" with it on sign-up, where Google is the only other way', async () => {
    googleSays(false);
    await render('signup');
    expect(shown()).toBe('');
  });

  it('shows on sign-up, under its "or", when Google is on', async () => {
    googleSays(true);
    await render('signup');

    expect(shown()).toContain('auth.login.or');
    expect(shown()).toContain('auth.oauth.continueWithGoogle');
  });
});
