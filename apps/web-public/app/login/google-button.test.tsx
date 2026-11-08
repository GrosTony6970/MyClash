// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Suspense, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en, fr } from '@myclash/i18n';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../src/i18n/I18nProvider';
import ClaimPage from '../e/[eventSlug]/claim/page';
import PublicLoginPage from './page';

/**
 * Google is off in production. A fencer who tapped "Continue with Google" landed on the sign-in
 * server's bare "provider is not enabled" page (ruling 495). Each Google button now asks the
 * sign-in server first, and shows on a yes only.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams('personId=person-1'),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const GOOGLE = en.auth.oauth.continueWithGoogle;

let container: HTMLDivElement;
let root: Root;
let settings: ReturnType<typeof vi.fn>;

function googleSays(google: boolean) {
  settings.mockResolvedValue(new Response(JSON.stringify({ external: { email: true, google } })));
}

async function render(screen: ReactNode) {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <Suspense>{screen}</Suspense>
      </I18nProvider>,
    );
  });
}

const login = () => <PublicLoginPage searchParams={Promise.resolve({})} />;
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

describe('the Google button on the public sign-in page', () => {
  it('shows when the sign-in server says Google is on, after asking it', async () => {
    googleSays(true);
    await render(login());

    expect(settings).toHaveBeenCalledWith('https://app.myclash.test/auth/v1/settings', {
      credentials: 'omit',
    });
    expect(shown()).toContain(GOOGLE);
  });

  it('is gone while Google is off; the email link stays', async () => {
    googleSays(false);
    await render(login());

    expect(shown()).not.toContain(GOOGLE);
    expect(shown()).toContain(en.publicApp.login.sendMagicLink);
  });

  it('opens on words that promise no Google, in both languages', () => {
    expect(en.publicApp.login.formDescription).toBe('Use your MyClash account.');
    expect(fr.publicApp.login.formDescription).toBe('Utilisez votre compte MyClash.');
    expect(en.auth.login.formDescription).toBe(
      'Sign in with your administrator credentials or a magic link.',
    );
    expect(fr.auth.login.formDescription).toBe(
      'Connectez-vous avec vos identifiants administrateur ou un lien magique.',
    );
  });
});

describe('the Google button on the claim page', () => {
  it('shows when Google is on', async () => {
    googleSays(true);
    await render(<ClaimPage />);

    expect(shown()).toContain(GOOGLE);
  });

  it('is gone while Google is off; the emailed link stays', async () => {
    googleSays(false);
    await render(<ClaimPage />);

    expect(shown()).not.toContain(GOOGLE);
    expect(shown()).toContain(en.publicApp.claim.sendConfirmationLink);
  });
});

describe("the Google button on a Workshop's page", () => {
  // The page reads the Event, the Workshop and the caller's bookings: it is read as text.
  const page = readFileSync(join(__dirname, '../e/[eventSlug]/w/[workshopSlug]/page.tsx'), 'utf8');

  it('asks the sign-in server, and shows on a yes only', () => {
    expect(page).toContain(
      "const googleOn = useGoogleSignInOn(process.env['NEXT_PUBLIC_SUPABASE_URL']);",
    );
    expect(page).toContain('{personId && googleOn && (');
    expect(page.match(/continueWithGoogle/g)).toHaveLength(1);
  });
});
