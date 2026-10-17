import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import OrganizerChoosePasswordPage from './page';

/**
 * The organiser's "choose your password" page (ruling "Pre-takeover").
 *
 * Claire opens her sign-up mail. A mail scanner opens links too, so opening the page must
 * send nothing. ONE request, on her press, sends the code, the password and the club the link
 * carries; then the page opens the club the door made.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const LINK =
  '/auth/choose-password?orgName=Lyon+AMHE&orgSlug=lyon-amhe&acceptedTerms=v1&acceptedPrivacy=v2&token_hash=c0de';
const CHOSEN = 'A-much-Longer-passw0rd!';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  window.history.replaceState(null, '', LINK);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function open() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <OrganizerChoosePasswordPage />
      </I18nProvider>,
    );
  });
  await settle();
}

/** Types into a controlled input as a person does: React reads the native value setter. */
function type(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function choose() {
  await act(async () => {
    type('new-password', CHOSEN);
    type('new-password-confirm', CHOSEN);
  });
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Save my password',
  );
  expect(save?.disabled).toBe(false);
  await act(async () => save!.click());
  await settle();
}

describe('the organiser choose-password page', () => {
  it('sends nothing on load, then one request with the code, the password and the club', async () => {
    // A hash for `next`: jsdom moves a page only within itself, which proves the page went there.
    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      data: { saved: true, signedIn: true, next: '#org-lyon-amhe' },
    });
    await open();
    expect(apiRequest).not.toHaveBeenCalled();

    await choose();

    expect(vi.mocked(apiRequest).mock.calls).toEqual([
      [
        'http://api.test',
        '/api/v1/auth/signup-choose-password',
        {
          method: 'POST',
          body: {
            token_hash: 'c0de',
            password: CHOSEN,
            orgName: 'Lyon AMHE',
            orgSlug: 'lyon-amhe',
            acceptedTerms: 'v1',
            acceptedPrivacy: 'v2',
          },
          signal: expect.any(AbortSignal),
        },
      ],
    ]);
    expect(window.location.hash).toBe('#org-lyon-amhe');
  });

  // Ruling 363: the code is spent, so the form goes; the way on is a second sign-up.
  it('says a club that was not made, and leads to the sign-up instead of the spent form', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      data: { code: 'club_not_made', saved: true, signedIn: true },
    });
    await open();

    await choose();

    expect(document.body.textContent).toContain('We could not create your organization.');
    expect(document.getElementById('new-password')).toBeNull();
    const again = [...document.querySelectorAll('a')].find(
      (a) => a.textContent === 'Sign up again',
    );
    expect(again?.getAttribute('href')).toBe('/signup');
  });

  it('offers to open the club when the password was not saved', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      data: { saved: false, signedIn: true, next: '/org/lyon-amhe' },
    });
    await open();

    await choose();

    expect(document.body.textContent).toContain('your password was not saved');
    const club = [...document.querySelectorAll('a')].find(
      (a) => a.textContent === 'Open my organization',
    );
    expect(club?.getAttribute('href')).toBe('/org/lyon-amhe');
  });

  it('sends nothing when the link lost its club, and says so', async () => {
    window.history.replaceState(null, '', '/auth/choose-password?token_hash=c0de');
    await open();

    await choose();

    expect(apiRequest).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('This link is incomplete.');
  });
});
