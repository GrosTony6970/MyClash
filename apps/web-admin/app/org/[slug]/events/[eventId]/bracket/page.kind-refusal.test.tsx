import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import BracketPage from './page';

/**
 * A team Tournament takes no bracket in slice 1b-1: the API refuses the generation with a 409 whose
 * `details.reason` is `team_tournament_not_supported`. The page said the API's English sentence, to
 * a French organiser too, and first read the 409 as "a bracket exists" and offered to overwrite it.
 * Now it says the refusal in the reader's language, and asks nothing.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams('tournamentId=t1'),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: 'running' }] }),
}));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => {} }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const API_SENTENCE =
  'A team Tournament runs Pools only for now: it takes no bracket and no Swiss phase.';
const NOT_SUPPORTED = {
  ok: false,
  kind: 'http',
  status: 409,
  detail: API_SENTENCE,
  code: 'CONFLICT',
  details: { reason: 'team_tournament_not_supported', message: API_SENTENCE },
  validationErrors: null,
};
const GENERATE = '/api/v1/tournaments/t1/generate-bracket';

/** The generation calls the page sent, by path. */
let sent: string[];

function serve() {
  sent = [];
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path === '/api/v1/events/ev1/tournaments') {
      return { ok: true, data: [{ id: 't1', name: 'Team Longsword' }] } as never;
    }
    if (path === '/api/v1/tournaments/t1')
      return { ok: true, data: { weapon: 'longsword' } } as never;
    if (path === '/api/v1/tournaments/t1/bracket') return { ok: true, data: null } as never;
    if (path === '/api/v1/tournaments/t1/registrations') return { ok: true, data: [] } as never;
    if (path === '/api/v1/events/ev1/lices') return { ok: true, data: [] } as never;
    if (path === '/api/v1/events/ev1/referee-skills') return { ok: true, data: [] } as never;
    if (path === '/api/v1/events/ev1/referee-assignment-board') {
      return { ok: true, data: null } as never;
    }
    if (path.startsWith(GENERATE)) {
      sent.push(path);
      return NOT_SUPPORTED as never;
    }
    throw new Error(`unexpected request ${path}`);
  });
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openPage(locale: 'en' | 'fr') {
  serve();
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ToastProvider>
          <BracketPage />
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

const page = () => document.body.textContent ?? '';

describe('Bracket page: a team Tournament takes no bracket', () => {
  it('says so in English, and offers no overwrite', async () => {
    await openPage('en');

    await tap('Generate bracket');

    expect(page()).toContain(
      'A team tournament runs pools only for now: it takes no bracket and no Swiss phase.',
    );
    expect(page()).not.toContain(API_SENTENCE);
    expect(page()).not.toContain('Regenerate bracket?');
    expect(sent).toEqual([GENERATE]);
  });

  it('says so in French', async () => {
    await openPage('fr');

    await tap('Générer le tableau');

    expect(page()).toContain(
      "Un tournoi par équipes se joue en poules seulement pour l'instant : il ne prend ni tableau ni phase suisse.",
    );
    expect(page()).not.toContain(API_SENTENCE);
  });
});
