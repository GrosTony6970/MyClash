import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { BracketSideWire, TournamentBracketSlotWire } from '@myclash/types/bracket-side';
import { I18nProvider } from '@/i18n/I18nProvider';
import FinalRankingPage from './page';

/**
 * The final ranking of a team Tournament ranks teams (call 7 of slice 1c-1): each row draws the
 * team's colour chip before its name, and the column says "Team", not "Fighter".
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
  useOrganizerSelectedEvent: () => ({ orgName: null, events: [] }),
}));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => {} }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
/** The text of each CSV the page hands to the browser. */
const downloads = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/csv-file', () => ({
  downloadCsv: (_filename: string, text: string) => downloads.push(text),
}));

const team = (teamId: string, name: string, colour: string): BracketSideWire => ({
  sideId: teamId,
  kind: 'team',
  registrationId: null,
  teamId,
  name,
  clubAbbrev: null,
  colour,
});

/** The final: Alpha beat Bravo. */
const FINAL: TournamentBracketSlotWire = {
  id: 's1',
  round: 1,
  position: 1,
  roundCode: 'LSW-B-F-M1',
  redFighterName: 'Alpha',
  blueFighterName: 'Bravo',
  redClubAbbrev: null,
  blueClubAbbrev: null,
  redRegistrationId: null,
  blueRegistrationId: null,
  winnerRegistrationId: null,
  redSideId: 'tm1',
  blueSideId: 'tm2',
  winnerSideId: 'tm1',
  red: team('tm1', 'Alpha', 'green'),
  blue: team('tm2', 'Bravo', 'purple'),
  redScore: 5,
  blueScore: 3,
  status: 'completed',
  matchId: 'm1',
  scheduledAt: null,
  liceId: null,
  liceName: null,
  referees: [],
  source_a_type: null,
  source_a_ref: null,
  source_b_type: null,
  source_b_ref: null,
  registration_a_id: null,
  registration_b_id: null,
};

function serve(kind: 'team' | 'individual') {
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    const answers: Record<string, unknown> = {
      '/api/v1/events/ev1/tournaments': [{ id: 't1', name: 'Team Longsword', entrant_kind: kind }],
      '/api/v1/tournaments/t1/bracket': {
        phaseId: 'ph1',
        phaseType: 'single_elim',
        bronzeSlotId: null,
        slots: [FINAL],
      },
      '/api/v1/tournaments/t1/pool-standings?mode=overall': { rows: [] },
    };
    if (!(path in answers)) throw new Error(`unexpected request ${path}`);
    return { ok: true, data: answers[path] } as never;
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  downloads.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openPage(kind: 'team' | 'individual', locale: 'en' | 'fr' = 'en') {
  serve(kind);
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ToastProvider>
          <FinalRankingPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const headers = () => [...container.querySelectorAll('th')].map((th) => th.textContent?.trim());
/** The colour dots drawn in the ranking's rows. */
const rowChips = () => container.querySelectorAll('tbody span.rounded-full');

describe('Final ranking of a team Tournament', () => {
  it('heads the column "Team" and draws each team with its chip', async () => {
    await openPage('team');

    expect(headers()).toContain('Team');
    expect(headers()).not.toContain('Fighter');
    const rows = [...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
    expect(rows[0]).toContain('Alpha');
    expect(rows[1]).toContain('Bravo');
    expect(rowChips()).toHaveLength(2);
  });

  it('heads the column "Équipe" in French', async () => {
    await openPage('team', 'fr');

    expect(headers()).toContain('Équipe');
  });

  it('keeps "Fighter" on an individual Tournament', async () => {
    await openPage('individual');

    expect(headers()).toContain('Fighter');
    expect(headers()).not.toContain('Team');
  });

  it('says teams, not fighters, are separated by their pool score', async () => {
    await openPage('team');
    expect(container.textContent).toContain(
      'Bracket placement — teams eliminated in the same round are separated by their pool score.',
    );
    expect(container.textContent).not.toContain('fighters eliminated');

    await openPage('team', 'fr');
    expect(container.textContent).toContain(
      'Placement au tableau — les équipes éliminées au même tour sont départagées par leur score de poule.',
    );
  });

  /** Export CSV, then the standard file in its menu; the file's lines, after the byte-order mark. */
  async function exportCsv(): Promise<string[]> {
    const button = (text: string) =>
      [...document.body.querySelectorAll('button, [role="menuitem"]')].find((b) =>
        b.textContent?.startsWith(text),
      ) as HTMLElement;
    await act(async () => button('Export CSV').click());
    await act(async () => button('Excel (English), other apps').click());
    expect(downloads).toHaveLength(1);
    return downloads[0]!.slice(1).split('\r\n');
  }

  // A team has no club: an always-empty Club column would say nothing.
  it('exports a team ranking with no Club column', async () => {
    await openPage('team');
    const lines = await exportCsv();
    expect(lines[0]).toBe('Rank,Team,Result,Pool score');
    expect(lines[1]).toMatch(/^1,Alpha,/);
  });

  it('keeps the Club column in an individual ranking', async () => {
    await openPage('individual');
    const lines = await exportCsv();
    expect(lines[0]).toBe('Rank,Fighter,Club,Result,Pool score');
  });

  it('keeps the fighters subtitle on an individual Tournament', async () => {
    await openPage('individual');
    expect(container.textContent).toContain(
      'Bracket placement — fighters eliminated in the same round are separated by their pool score.',
    );
  });
});
