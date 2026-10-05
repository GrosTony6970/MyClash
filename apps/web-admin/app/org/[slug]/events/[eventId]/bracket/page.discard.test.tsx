import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import BracketPage from './page';

/**
 * "Regenerate bracket" and "Delete bracket" over fought bouts (ruling 285).
 *
 * The page counts the fought bouts from what it last read. The pad on piste 1
 * starts the first bout while the owner's confirm is open: her confirm named no
 * fought bout, and the bout went with the bracket.
 *
 * Now the server's count decides, as on the Pools page. The page never says the
 * discard on its own count: the server refuses and sends its count, a confirm
 * names it, and its yes sends the discard. The page had counted one bout and
 * two more started: the confirm names three.
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
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => {} }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

/** The bracket as the page read it: its one bout is fought, or not yet. */
function bracket(fought: boolean) {
  return {
    phaseId: 'ph1',
    phaseType: 'single_elim',
    bracketSize: 2,
    fighterCount: 2,
    byeCount: 0,
    rounds: 1,
    totalSlots: 1,
    slots: [
      {
        id: 's1',
        round: 1,
        position: 1,
        redFighterName: 'Ada',
        blueFighterName: 'Grace',
        redScore: null,
        blueScore: null,
        status: fought ? 'completed' : 'scheduled',
        matchId: 'm1',
      },
    ],
  };
}

const refused = (status: number, code: string, details: Record<string, unknown> | null = null) => ({
  ok: false,
  kind: 'http',
  status,
  detail: 'An English sentence from the API.',
  code,
  details,
  validationErrors: null,
});
const fought = (count: number) =>
  refused(409, 'scored_bouts_would_be_discarded', { scoredMatches: count });
const NOT_THE_OWNER = refused(403, 'discard_requires_owner');
const DONE = { ok: true, data: null };

const GENERATE = '/api/v1/tournaments/t1/generate-bracket';
const PHASE = '/api/v1/phases/ph1';

/** Each regenerate and delete call, as the page sent it. */
let sent: Array<{ path: string; discard: unknown }>;

/** Answers the page's reads; the regenerate and delete calls are answered from `answers`, in order. */
function serve(read: ReturnType<typeof bracket>, answers: unknown[]) {
  sent = [];
  vi.mocked(apiRequest).mockImplementation(
    async (_base: string, path: string, init?: { method?: string; body?: unknown }) => {
      if (path === '/api/v1/events/ev1/tournaments') {
        return { ok: true, data: [{ id: 't1', name: 'Longsword' }] };
      }
      if (path === '/api/v1/events/ev1') return { ok: true, data: { status: 'running' } };
      if (path === '/api/v1/tournaments/t1') return { ok: true, data: { weapon: 'longsword' } };
      if (path === '/api/v1/tournaments/t1/bracket') return { ok: true, data: read };
      if (path === '/api/v1/tournaments/t1/registrations') return { ok: true, data: [] };
      if (path === '/api/v1/events/ev1/lices') return { ok: true, data: [] };
      if (path === '/api/v1/events/ev1/referee-skills') return { ok: true, data: [] };
      if (path === '/api/v1/events/ev1/referee-assignment-board') return { ok: true, data: null };
      if (path.startsWith(GENERATE) || (path.startsWith(PHASE) && init?.method === 'DELETE')) {
        const body = init?.body as Record<string, unknown> | undefined;
        sent.push({ path, discard: body?.['discardScoredResults'] });
        const answer = answers.shift();
        if (answer) return answer as never;
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openPage(read: ReturnType<typeof bracket>, answers: unknown[]) {
  serve(read, answers);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <BracketPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

/** Clicks the LAST button with this label: a modal's button sits after the page's own. */
async function tap(label: string) {
  const button = [...document.body.querySelectorAll('button')]
    .filter((candidate) => candidate.textContent?.trim() === label)
    .at(-1);
  expect(button, `no button named ${label}`).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

const ONE_FOUGHT =
  'One bout in this bracket has already been fought. Its result and its exchanges go with it.';
const TWO_FOUGHT =
  '2 bouts in this bracket have already been fought. Their results and their exchanges go with them.';
const THREE_FOUGHT =
  '3 bouts in this bracket have already been fought. Their results and their exchanges go with them.';
const ASKS = 'Delete fought bouts?';
const page = () => document.body.textContent ?? '';

describe('Bracket page: regenerate over fought bouts (ruling 285)', () => {
  it('a bout fought after the page read: the server’s count is asked, and yes sends the discard', async () => {
    await openPage(bracket(false), [fought(1), { ok: true, data: bracket(false) }]);

    await tap('Regenerate bracket');
    expect(page()).not.toContain(ONE_FOUGHT);
    await tap('Yes, regenerate');

    expect(page()).toContain(ASKS);
    expect(page()).toContain(ONE_FOUGHT);

    await tap('Yes, regenerate');

    expect(sent).toEqual([
      { path: `${GENERATE}?force=true`, discard: undefined },
      { path: `${GENERATE}?force=true`, discard: true },
    ]);
    expect(page()).not.toContain(ASKS);
  });

  it('a fought bout the page had counted is not a discard said: the server’s count is asked', async () => {
    await openPage(bracket(true), [fought(3), { ok: true, data: bracket(false) }]);

    await tap('Regenerate bracket');
    expect(page()).toContain(ONE_FOUGHT);
    await tap('Yes, regenerate');

    expect(sent).toEqual([{ path: `${GENERATE}?force=true`, discard: undefined }]);
    expect(page()).toContain(THREE_FOUGHT);
  });

  it('an admin who is not the owner is told so, and no confirm comes back', async () => {
    await openPage(bracket(false), [fought(2), NOT_THE_OWNER]);

    await tap('Regenerate bracket');
    await tap('Yes, regenerate');
    expect(page()).toContain(TWO_FOUGHT);
    await tap('Yes, regenerate');

    expect(page()).toContain(
      'Only the owner of the organisation can delete bouts that have been fought.',
    );
    expect(page()).not.toContain(ASKS);
    expect(sent).toHaveLength(2);
  });

  // Every 409 of a forced call opened "Regenerate bracket?" again, for ever.
  it('another refusal of a forced call is said, not asked again', async () => {
    await openPage(bracket(false), [refused(409, 'CONFLICT')]);

    await tap('Regenerate bracket');
    await tap('Yes, regenerate');

    expect(page()).toContain('An English sentence from the API.');
    expect(page()).not.toContain('Regenerate bracket?');
  });

  it('cancel on the server’s count sends nothing more', async () => {
    await openPage(bracket(false), [fought(1)]);

    await tap('Regenerate bracket');
    await tap('Yes, regenerate');
    await tap('Cancel');

    expect(sent).toHaveLength(1);
    expect(page()).not.toContain(ASKS);
  });
});

describe('Bracket page: delete over fought bouts (ruling 285)', () => {
  it('a bout fought after the page read: the server’s count is asked, and yes sends the discard', async () => {
    await openPage(bracket(false), [fought(2), DONE]);

    await tap('Delete bracket');
    await tap('Delete bracket');

    expect(page()).toContain(ASKS);
    expect(page()).toContain(TWO_FOUGHT);
    expect(page()).not.toContain('Delete this bracket?');

    await tap('Delete bracket');

    expect(sent.map((call) => call.path)).toEqual([PHASE, `${PHASE}?discardScoredResults=true`]);
    expect(page()).not.toContain(ASKS);
  });

  it('a fought bout the page had counted is not a discard said: the server’s count is asked', async () => {
    await openPage(bracket(true), [fought(3)]);

    await tap('Delete bracket');
    await tap('Delete bracket');

    expect(sent.map((call) => call.path)).toEqual([PHASE]);
    expect(page()).toContain(THREE_FOUGHT);
  });

  it('an admin who is not the owner is told so, and no confirm comes back', async () => {
    await openPage(bracket(false), [fought(1), NOT_THE_OWNER]);

    await tap('Delete bracket');
    await tap('Delete bracket');
    await tap('Delete bracket');

    expect(page()).toContain(
      'Only the owner of the organisation can delete bouts that have been fought.',
    );
    expect(page()).not.toContain(ASKS);
  });
});
