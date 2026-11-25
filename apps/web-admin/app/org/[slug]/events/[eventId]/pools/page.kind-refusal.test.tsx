import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { en } from '@myclash/i18n';
import { I18nProvider } from '@/i18n/I18nProvider';
import PoolsPage from './page';
import type { PoolMemberSeat, PoolSeat } from './pool-seats';

/**
 * The refusals of a Tournament's kind of entrant, on the Pools page. A generation that sends a field
 * the kind refuses gets a 400 whose `code` is `entrant_kind_field` (the page read the kind before
 * the Tournament list landed). A seat of the other kind gets a 409 whose `details.reason` is
 * `entrant_kind_mismatch`. The page said the API's English sentence; a seat refusal even stood as
 * "the Pool is locked". Now each is said in the reader's language.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
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
vi.mock('./_tabs/MatchesTab', () => ({ MatchesTab: () => null }));
vi.mock('./_tabs/StandingsTab', () => ({ StandingsTab: () => null }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const API_SENTENCE = 'An English sentence from the API.';
const refused = (status: number, code: string, details: Record<string, unknown> | null) => ({
  ok: false,
  kind: 'http',
  status,
  detail: API_SENTENCE,
  code,
  details,
  validationErrors: null,
});
const FIELD_REFUSED = refused(400, 'entrant_kind_field', null);
const KIND_MISMATCH = refused(409, 'CONFLICT', { reason: 'entrant_kind_mismatch' });

const teamSeat = (id: string, name: string): PoolSeat => ({
  sideId: id,
  kind: 'team',
  registrationId: null,
  name,
  personName: null,
  clubLabel: null,
  colour: 'red',
  logoUrl: null,
  hemaWeightedRating: null,
});

/** Serves a team Tournament; every write is answered with `refusal`. */
function serve(members: PoolMemberSeat[], waiting: PoolSeat[], refusal: unknown) {
  vi.mocked(apiRequest).mockImplementation(
    async (_base: string, path: string, init?: { method?: string }) => {
      if (init?.method) return refusal as never;
      if (path === '/api/v1/events/ev1/tournaments') {
        return { ok: true, data: [{ id: 't1', name: 'Team Longsword', entrant_kind: 'team' }] };
      }
      if (path === '/api/v1/tournaments/t1/pools') {
        const pools = members.length > 0 ? [{ id: 'p1', name: 'Pool 1', members }] : [];
        return { ok: true, data: { phaseId: members.length > 0 ? 'ph1' : null, pools } };
      }
      if (path === '/api/v1/tournaments/t1/unassigned-fighters') {
        return { ok: true, data: waiting };
      }
      if (path === '/api/v1/tournaments/t1/conflict-check') {
        return { ok: true, data: { conflicts: [] } };
      }
      throw new Error(`unexpected request ${path}`);
    },
  );
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
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openPage(locale: 'en' | 'fr' = 'en') {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ToastProvider>
          <PoolsPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

const page = () => document.body.textContent ?? '';
const chip = (name: string) =>
  [...container.querySelectorAll('[draggable]')].find((el) => el.textContent?.includes(name))!;

async function tap(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button, `no button named ${label}`).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

async function fire(element: Element, type: 'dragstart' | 'drop') {
  await act(async () => {
    element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  });
  await settle();
}

const FIELD_WORDS_EN =
  "These settings do not fit this tournament's kind of entrant. Reload the page and try again.";
const MISMATCH_WORDS_EN =
  'This tournament takes the other kind of entrant: a team tournament takes teams, an individual one takes fighters.';

describe('Pools page: a refusal of the Tournament’s kind', () => {
  it('a generation with a field the kind refuses is said in words', async () => {
    serve([], [teamSeat('team-lyon', 'Lyon Blades')], FIELD_REFUSED);
    await openPage();

    await tap('Generate pools');

    expect(page()).toContain(FIELD_WORDS_EN);
    expect(page()).not.toContain(API_SENTENCE);
  });

  it('a 409 of the kind on a generation is said, not asked as an overwrite', async () => {
    serve([], [teamSeat('team-lyon', 'Lyon Blades')], KIND_MISMATCH);
    await openPage();

    await tap('Generate pools');

    expect(page()).toContain(MISMATCH_WORDS_EN);
    expect(page()).not.toContain(API_SENTENCE);
    expect(page()).not.toContain(en.organizer.pools.page.regenerateConfirmTitle);
  });

  it('a seat of the other kind is said in words, not as a locked Pool', async () => {
    serve(
      [{ ...teamSeat('team-paris', 'Paris Rapiers'), seed: 1 }],
      [teamSeat('team-lyon', 'Lyon Blades')],
      KIND_MISMATCH,
    );
    await openPage();

    await fire(chip('Lyon Blades'), 'dragstart');
    await fire(chip('Paris Rapiers'), 'drop');

    expect(page()).toContain(MISMATCH_WORDS_EN);
    expect(page()).not.toContain(API_SENTENCE);
  });

  it('says it in French to a French organiser', async () => {
    serve([], [teamSeat('team-lyon', 'Lyon Blades')], FIELD_REFUSED);
    await openPage('fr');

    await tap('Générer les poules');

    expect(page()).toContain(
      'Ces réglages ne conviennent pas au type de participant de ce tournoi. Rechargez la page et réessayez.',
    );
    expect(page()).not.toContain(API_SENTENCE);
  });
});
