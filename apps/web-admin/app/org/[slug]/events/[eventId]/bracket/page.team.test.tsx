import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import type * as Ui from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import BracketPage from './page';
import { BRACKET, PLAYED, RATING_REFUSED, RATING_SENTENCE } from './page.team.fixtures';

/**
 * The bracket page of a team Tournament (slice 1c-1). A team side is no Registration: the forfeit
 * names the team (`forfeitingTeamId`), the slot override picks among the Tournament's teams and
 * sends `teamAId` (call 4), and the dialogs do not offer what a team Tournament refuses — double
 * elimination, a seed by rating (call 3). With no Pools the page speaks of the teams' seed order
 * (ruling 982). And a seed by rating that the API refuses is said in the reader's language, not as
 * "Round 1 has started" or as "a bracket exists".
 */

const captured = vi.hoisted(() => ({
  openSlot: null as ((slotId: string) => void) | null,
  podium: null as unknown,
}));

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
vi.mock('@myclash/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  BracketView: (props: { onOverrideSlot: (slotId: string) => void }) => {
    captured.openSlot = props.onOverrideSlot;
    return null;
  },
  MedalPodium: (props: { podium: unknown }) => {
    captured.podium = props.podium;
    return null;
  },
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

interface Sent {
  method: string;
  path: string;
  body: unknown;
}
let sent: Sent[];

interface Serve {
  /** The kind the Event's Tournament list says; null leaves the field out. */
  kind?: 'team' | 'individual' | null;
  bracket?: unknown;
  /** The answer to a write; ok by default. */
  write?: (path: string) => unknown;
}

function serve({ kind = 'team', bracket = BRACKET, write }: Serve = {}) {
  sent = [];
  vi.mocked(apiRequest).mockImplementation(
    async (_base: string, path: string, init?: { method?: string; body?: unknown }) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        sent.push({ method, path, body: init?.body });
        const refused = write?.(path);
        if (refused) return refused as never;
        if (path.endsWith('/populate-bracket')) {
          return { ok: true, data: { source: 'registration-seed', warnings: [] } } as never;
        }
        if (path.includes('/generate-bracket')) return { ok: true, data: BRACKET } as never;
        return { ok: true, data: {} } as never;
      }
      const answers: Record<string, unknown> = {
        '/api/v1/events/ev1/tournaments': [
          { id: 't1', name: 'Team Longsword', ...(kind ? { entrant_kind: kind } : {}) },
        ],
        '/api/v1/tournaments/t1': { weapon: 'longsword' },
        '/api/v1/tournaments/t1/bracket': bracket,
        '/api/v1/tournaments/t1/registrations': [],
        '/api/v1/tournaments/t1/teams': [
          { id: 'tm2', name: 'Bravo', seed: null, color: 'purple' },
          { id: 'tm3', name: 'Charlie', seed: 1, color: 'red' },
        ],
        '/api/v1/events/ev1/lices': [],
        '/api/v1/events/ev1/referee-skills': [],
        '/api/v1/events/ev1/referee-assignment-board': null,
      };
      if (!(path in answers)) throw new Error(`unexpected request ${path}`);
      return { ok: true, data: answers[path] } as never;
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
  captured.openSlot = null;
  captured.podium = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openPage(options: Serve = {}, locale: 'en' | 'fr' = 'en') {
  serve(options);
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
  const button = [...document.body.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  expect(button, `no button named ${label}`).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

async function openSlot(slotId: string) {
  expect(captured.openSlot, 'the bracket was not drawn').not.toBeNull();
  await act(async () => captured.openSlot!(slotId));
  await settle();
}

const page = () => document.body.textContent ?? '';
/** The option values of every select on the page, one list per select. */
const selects = () =>
  [...document.body.querySelectorAll('select')].map((select) =>
    [...select.options].map((option) => option.value),
  );

describe('Bracket page of a team Tournament', () => {
  it('forfeits a team side by its team', async () => {
    await openPage();
    await openSlot('s1');

    await tap('Team 1 forfeits');
    await tap('Record forfeit');

    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/v1/matches/m1/forfeit',
        body: { forfeitingTeamId: 'tm1', reason: 'voluntary' },
      },
    ]);
  });

  // The slot keys its blue side but sends no typed side for it: no Registration and no team to
  // forfeit. The sentence names what is missing, never an id.
  it('names the side, never an id, when the side to forfeit holds nobody', async () => {
    const [s1] = BRACKET.slots;
    await openPage({ bracket: { ...BRACKET, slots: [{ ...s1!, blue: null }] } });
    await openSlot('s1');

    await tap('Team 2 forfeits');
    await tap('Record forfeit');

    expect(sent).toEqual([]);
    expect(page()).toContain('This side has no fighter or team yet.');
    expect(page()).not.toContain('registration id');
  });

  it('overrides a slot with a team of the Tournament', async () => {
    await openPage();
    await openSlot('s1');

    expect(page()).toContain('Side A (team 1)');
    const charlie = [...document.body.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === 'Charlie',
    );
    expect(charlie).toHaveLength(2);
    await act(async () => charlie[0]!.click());
    await tap('Save');

    expect(sent).toEqual([
      { method: 'PATCH', path: '/api/v1/bracket-slots/s1', body: { teamAId: 'tm3' } },
    ]);
  });

  it('offers no double elimination and no seed by rating when generating', async () => {
    await openPage({ bracket: null });

    const options = selects().flat();
    expect(options).toContain('single_elim');
    expect(options).not.toContain('double_elim');
    expect(options).toContain('snake');
    expect(options).not.toContain('by-rating');
    expect(options).not.toContain('by-swiss-rank');

    await tap('Generate bracket');
    expect(sent).toEqual([
      expect.objectContaining({
        path: '/api/v1/tournaments/t1/generate-bracket',
        body: { phaseType: 'single_elim', seedingStrategy: 'snake' },
      }),
    ]);
  });

  it('offers no seed by rating when reseeding', async () => {
    await openPage();
    await tap('Re-seed Round 1');

    const reseed = selects().find((values) => values.includes('random'));
    expect(reseed).toEqual(['snake', 'random', 'by-pool-rank']);
  });

  it('speaks of the teams’ seed order when there are no Pools', async () => {
    await openPage();

    await tap('Re-seed Round 1');
    expect(page()).toContain('Standard — pool rank, or team seed order (recommended)');
    expect(page()).not.toContain('registration seed');

    await tap('Auto-populate bracket');
    expect(page()).toContain('the seeded teams first');
    await tap('Seed in team seed order');

    expect(sent.map((s) => s.path)).toEqual(['/api/v1/tournaments/t1/populate-bracket']);
    expect(page()).toContain('Bracket populated in team seed order (no pool data)');
    expect(page()).not.toContain('from registration');
  });

  it('speaks of the teams’ seed order in French', async () => {
    await openPage({}, 'fr');

    await tap('Remplir le tableau');
    await tap('Classer par têtes de série des équipes');

    expect(page()).toContain(
      "Tableau rempli dans l'ordre des têtes de série des équipes (aucune donnée de poule)",
    );
  });

  /** The config card's figure under its label. */
  const configFigure = (label: string) =>
    [...document.body.querySelectorAll('p')].find((p) => p.textContent === label)
      ?.nextElementSibling?.textContent;

  it('counts the bracket’s teams on the config card, not its fighters', async () => {
    await openPage();
    expect(configFigure('Teams')).toBe('2');
    expect(configFigure('Fighters')).toBeUndefined();
  });

  it('counts the bracket’s teams in French', async () => {
    await openPage({}, 'fr');
    expect(configFigure('Équipes')).toBe('2');
    expect(configFigure('Combattants')).toBeUndefined();
  });

  it('says the bracket to generate is for the teams, in English and French', async () => {
    await openPage({ bracket: null });
    expect(page()).toContain("lock in the matchups for the tournament's teams.");
    expect(page()).not.toContain('registered fighters');

    act(() => root.unmount());
    root = createRoot(container);
    await openPage({ bracket: null }, 'fr');
    expect(page()).toContain('figer les rencontres des équipes du tournoi.');
    expect(page()).not.toContain('combattants inscrits');
  });

  it('says a deleted bracket is re-created from the teams', async () => {
    await openPage();
    await tap('Delete bracket');
    expect(page()).toContain("You can re-create the bracket later from the tournament's teams.");
    expect(page()).not.toContain('registered fighters');
  });

  it('draws the champion team with its colour on the podium', async () => {
    await openPage({ bracket: PLAYED });

    expect(captured.podium).toMatchObject({
      gold: { fighterName: 'Alpha', colour: 'green' },
      silver: { fighterName: 'Bravo', colour: 'purple' },
      bronze: { fighterName: 'Delta', colour: 'blue' },
      fourth: { fighterName: 'Charlie', colour: 'red' },
    });
  });
});

/**
 * The page can offer "By HEMA rating" on a team Tournament, and the API refuses it with
 * `rating_needs_named_members`. On a generation the page is stale: it was opened while the
 * Tournament was individual, and the organiser switched it to team in another tab since (it had
 * no Pools and no bracket yet, so ruling 989 let the switch through). On a reseed the bracket
 * exists, so the kind is locked (ruling 989): the page reads it as individual only when the list
 * leaves the field out.
 */
describe('Bracket page: a team bracket seeded by rating', () => {
  const refuseRating = (path: string) =>
    path.endsWith('/reseed') || path.includes('/generate-bracket') ? RATING_REFUSED : null;

  /** Picks "By HEMA rating" in the generation form, which the stale page still offers. */
  async function pickRating() {
    const seeding = [...document.body.querySelectorAll('select')].find((select) =>
      [...select.options].some((option) => option.value === 'by-rating'),
    );
    expect(seeding, 'the page offers no seed by rating').toBeDefined();
    await act(async () => {
      seeding!.value = 'by-rating';
      seeding!.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('names the refusal on a reseed, not "Round 1 has started"', async () => {
    await openPage({ kind: null, write: refuseRating });
    await tap('Re-seed Round 1');
    const reseed = [...document.body.querySelectorAll('select')].find((select) =>
      [...select.options].some((option) => option.value === 'random'),
    )!;
    await act(async () => {
      reseed.value = 'by-rating';
      reseed.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await tap('Apply');

    expect(sent).toEqual([
      { method: 'POST', path: '/api/v1/phases/ph1/reseed', body: { strategy: 'by-rating' } },
    ]);
    expect(page()).toContain(RATING_SENTENCE);
    expect(page()).not.toContain('Some Round 1 matches have already started');
  });

  it('names the refusal on a generation from a stale page, and asks no overwrite', async () => {
    await openPage({ kind: 'individual', bracket: null, write: refuseRating });
    await pickRating();

    await tap('Generate bracket');

    expect(sent).toEqual([
      expect.objectContaining({
        path: '/api/v1/tournaments/t1/generate-bracket',
        body: expect.objectContaining({ seedingStrategy: 'by-rating' }),
      }),
    ]);
    expect(page()).toContain(RATING_SENTENCE);
    expect(page()).not.toContain('Regenerate bracket?');
  });

  it('names the refusal in French', async () => {
    await openPage({ kind: 'individual', bracket: null, write: refuseRating }, 'fr');
    await pickRating();

    await tap('Générer le tableau');

    expect(page()).toContain(
      'Une équipe est classée par ses membres nommés : un tableau par équipes ne peut pas encore être tiré au classement.',
    );
    expect(page()).not.toContain(RATING_SENTENCE);
  });
});
