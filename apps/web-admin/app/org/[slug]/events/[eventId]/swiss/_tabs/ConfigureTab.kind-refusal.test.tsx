import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { SwissAdminView, UseSwissAdmin } from '../useSwissAdmin';
import { ConfigureTab } from './ConfigureTab';

/**
 * A team Tournament takes no Swiss phase (ADR-022): the API refuses the generation with a 409
 * whose `details.reason` is `team_tournament_not_supported`. The tab said the API's English
 * sentence, to a French organiser too. Now it says the refusal in the reader's language.
 */

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const API_SENTENCE = 'A team Tournament takes no double elimination and no Swiss phase yet.';

/** A Tournament with no Swiss phase yet, and two teams: the Generate button is live. */
const VIEW: SwissAdminView = {
  phaseId: null,
  config: null,
  registeredCount: 2,
  ratingCoverage: null,
  recommendedRoundCount: 3,
  entrants: [],
  rounds: [],
};

let container: HTMLDivElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function openTab(locale: 'en' | 'fr') {
  const swiss: UseSwissAdmin = {
    view: VIEW,
    loading: false,
    error: null,
    setError: () => undefined,
    reload: async () => undefined,
    nameOf: () => '',
  };
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ToastProvider>
          <ConfigureTab
            tournamentId="t-1"
            swiss={swiss}
            isReadOnly={false}
            slug="org"
            eventId="ev1"
          />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

async function tap(label: string) {
  const button = [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button, `no button named ${label}`).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async () => ({
    ok: false,
    kind: 'http',
    status: 409,
    detail: API_SENTENCE,
    code: 'CONFLICT',
    details: { reason: 'team_tournament_not_supported', message: API_SENTENCE },
    validationErrors: null,
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('the Swiss Configure tab: a team Tournament takes no Swiss phase', () => {
  it.each([
    ['en', en],
    ['fr', fr],
  ] as const)('says so in the reader’s language (%s)', async (locale, messages) => {
    await openTab(locale);

    await tap(messages.organizer.swiss.configure.generate);

    expect(document.body.textContent).toContain(
      messages.organizer.tournaments.kind.teamNotSupported,
    );
    expect(document.body.textContent).not.toContain(API_SENTENCE);
  });
});
