import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import FinalRankingPage from './page';

/**
 * The final ranking against the 30 s re-read (ruling 110a).
 *
 * The ranking is re-read every 30 s even while the live channel is up. Each
 * re-read used to swap the table for "Loading…" (the page jumped and Export went
 * grey), and a failed one blanked the ranking until the next. A re-read now
 * changes the table in place and a failed one leaves it alone; only a newly
 * chosen Tournament starts empty.
 */

const realtime = vi.hoisted(() => ({ poll: null as (() => void) | null }));

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
vi.mock('@/lib/supabase-browser', () => ({
  useRealtimeWithFallback: (opts: { onFallbackPoll: () => void }) => {
    realtime.poll = opts.onFallbackPoll;
  },
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

/** A decided two-fighter bracket: Ada beat Grace in the final. */
const BRACKET = {
  phaseId: 'ph1',
  phaseType: 'single_elim',
  bronzeSlotId: null,
  slots: [
    {
      id: 's1',
      round: 1,
      position: 1,
      redFighterName: 'Ada',
      blueFighterName: 'Grace',
      redRegistrationId: 'r1',
      blueRegistrationId: 'r2',
      winnerRegistrationId: 'r1',
      redScore: 5,
      blueScore: 3,
      status: 'completed',
      matchId: 'm1',
    },
  ],
};
const STANDINGS = { rows: [] };
const DOWN = { ok: false, kind: 'network' } as const;

type Answer = { ok: true; data: unknown } | typeof DOWN | Promise<never>;

/** What each Tournament's two reads answer now; a test changes it mid-way. */
let answers: Record<string, Answer> = {};

const TOURNAMENT_READ = /^\/api\/v1\/tournaments\/(t\d)\/(bracket|pool-standings\?mode=overall)$/;

function serve() {
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path === '/api/v1/events/ev1/tournaments') {
      return {
        ok: true,
        data: [
          { id: 't1', name: 'Longsword' },
          { id: 't2', name: 'Sabre' },
        ],
      };
    }
    const [, tournamentId = '', read] = TOURNAMENT_READ.exec(path) ?? [];
    const answer = answers[tournamentId];
    if (answer === undefined) throw new Error(`unexpected request ${path}`);
    if (answer instanceof Promise || !answer.ok) return answer as never;
    return { ok: true, data: read === 'bracket' ? answer.data : STANDINGS };
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
  realtime.poll = null;
  answers = { t1: { ok: true, data: BRACKET } };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openPage() {
  serve();
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <FinalRankingPage />
      </I18nProvider>,
    );
  });
  await settle();
}

async function poll() {
  expect(realtime.poll, 'the page registered no poll').not.toBeNull();
  await act(async () => realtime.poll!());
  await settle();
}

describe('Final ranking against the 30 s re-read', () => {
  it('a re-read on its way keeps the table and shows no Loading…', async () => {
    await openPage();
    expect(container.textContent).toContain('Ada');

    answers = { t1: new Promise<never>(() => {}) };
    await poll();

    expect(container.textContent).not.toContain('Loading…');
    expect(container.textContent).toContain('Ada');
  });

  it('a failed re-read keeps the ranking on screen', async () => {
    await openPage();
    expect(container.textContent).toContain('Ada');

    answers = { t1: DOWN };
    await poll();

    expect(container.textContent).toContain('Ada');
  });

  it('choosing another Tournament starts empty, even when its read fails', async () => {
    await openPage();
    expect(container.textContent).toContain('Ada');

    answers = { ...answers, t2: DOWN };
    const chip = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Sabre',
    );
    expect(chip, 'no Tournament chip named Sabre').toBeDefined();
    await act(async () => chip!.click());
    await settle();

    expect(container.textContent).not.toContain('Ada');
  });
});
