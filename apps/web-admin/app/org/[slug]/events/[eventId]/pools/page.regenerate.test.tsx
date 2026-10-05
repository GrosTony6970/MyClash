import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import PoolsPage from './page';

/**
 * "Regenerate" on Pools that hold fought bouts (ruling 280).
 *
 * The server refuses a forced regeneration over fought bouts until the discard
 * is said. The page read every 409 as "Pools already exist" and showed its
 * confirm again, for ever: the owner could not go on, and was told nothing.
 *
 * Now the first confirm is followed by a second one that names the count of
 * fought bouts. Yes sends the discard. An admin who is not the owner is then
 * told so, in the reader's language.
 */

vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'org', eventId: 'ev1' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('./_tabs/MatchesTab', () => ({ MatchesTab: () => null }));
vi.mock('./_tabs/StandingsTab', () => ({ StandingsTab: () => null }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const GENERATE = '/api/v1/tournaments/t1/generate-pools';
const refused = (status: number, code: string, details: Record<string, unknown> | null = null) => ({
  ok: false,
  kind: 'http',
  status,
  detail: 'An English sentence from the API.',
  code,
  details,
  validationErrors: null,
});
const EXISTS = refused(409, 'CONFLICT');
const FOUGHT = refused(409, 'scored_bouts_would_be_discarded', { scoredMatches: 2 });
const NOT_THE_OWNER = refused(403, 'discard_requires_owner');

/** Each generate call, as the page sent it. */
let sent: Array<{ path: string; body: unknown }>;

/** Answers the page's reads; the generate calls are answered from `answers`, in order. */
function serve(answers: unknown[]) {
  sent = [];
  vi.mocked(apiRequest).mockImplementation(
    async (_base: string, path: string, init?: { body?: unknown }) => {
      if (path === '/api/v1/events/ev1/tournaments') {
        return { ok: true, data: [{ id: 't1', name: 'Longsword' }] };
      }
      if (path === '/api/v1/events/ev1') return { ok: true, data: { status: 'running' } };
      if (path === '/api/v1/tournaments/t1/pools') {
        return { ok: true, data: { phaseId: 'phase-1', pools: [] } };
      }
      if (path === '/api/v1/tournaments/t1/unassigned-fighters') return { ok: true, data: [] };
      if (path === '/api/v1/tournaments/t1/conflict-check') {
        return { ok: true, data: { conflicts: [] } };
      }
      if (path.startsWith(GENERATE)) {
        sent.push({ path, body: init?.body });
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

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  // A generation that lands opens the matches tab by the hash, and the hash outlives a test.
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openPage() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <PoolsPage />
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

const FOUGHT_SENTENCE =
  '2 bouts of these pools have already been fought. Their results and their exchanges go with them.';
const page = () => document.body.textContent ?? '';

describe('Pools page: regenerate over fought bouts (ruling 280)', () => {
  it('a second confirm names the count, and yes sends the discard', async () => {
    serve([EXISTS, FOUGHT, { ok: true, data: {} }]);
    await openPage();

    await tap('Generate empty pools');
    await tap('Yes, regenerate');
    expect(page()).toContain(FOUGHT_SENTENCE);

    await tap('Yes, regenerate');

    expect(sent.map((call) => call.path)).toEqual([
      GENERATE,
      `${GENERATE}?force=true`,
      `${GENERATE}?force=true`,
    ]);
    expect(
      sent.map((call) => (call.body as Record<string, unknown>)['discardScoredResults']),
    ).toEqual([undefined, undefined, true]);
    expect(page()).not.toContain(FOUGHT_SENTENCE);
  });

  it('an admin who is not the owner is told so, and no confirm comes back', async () => {
    serve([EXISTS, FOUGHT, NOT_THE_OWNER]);
    await openPage();

    await tap('Generate empty pools');
    await tap('Yes, regenerate');
    await tap('Yes, regenerate');

    expect(page()).toContain(
      'Only the owner of the organisation can delete bouts that have been fought.',
    );
    expect(page()).not.toContain(FOUGHT_SENTENCE);
    expect(sent).toHaveLength(3);
  });

  // The dead loop: every 409 of a forced call opened the first confirm again.
  it('another refusal of a forced call is said, not asked again', async () => {
    serve([EXISTS, refused(409, 'CONFLICT')]);
    await openPage();

    await tap('Generate empty pools');
    await tap('Yes, regenerate');

    expect(page()).toContain('An English sentence from the API.');
    expect(page()).not.toContain('Existing pools and all their matches will be deleted.');
  });

  it('cancel on the second confirm sends nothing more', async () => {
    serve([EXISTS, FOUGHT]);
    await openPage();

    await tap('Generate empty pools');
    await tap('Yes, regenerate');
    await tap('Cancel');

    expect(sent).toHaveLength(2);
    expect(page()).not.toContain(FOUGHT_SENTENCE);
  });
});
