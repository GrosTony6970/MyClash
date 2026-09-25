import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import BracketPage from './page';

/**
 * The bracket page against the 30 s re-read (ruling 110a).
 *
 * The bracket is re-read every 30 s even while the live channel is up, which
 * made three old habits of this page visible:
 *  - each re-read set the "Grand final reset" toggle back to the saved value, so
 *    an operator who ticked it and had not pressed Save lost the tick. The form
 *    now follows the server only when the SAVED value changes;
 *  - a re-read never showed that a bracket was gone, so one deleted by another
 *    organiser stayed on screen;
 *  - a re-read already on its way when this page generated or deleted landed
 *    afterwards and put the old bracket back. Both writes now re-read, which
 *    aborts it.
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
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

function bracket(grandFinalReset: boolean) {
  return {
    phaseId: 'ph1',
    phaseType: 'double_elim',
    bracketSize: 4,
    fighterCount: 4,
    byeCount: 0,
    rounds: 2,
    grandFinalReset,
    secondChanceTarget: 'gold',
    bronzeMatch: true,
    repechageEntrySize: null,
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
        status: 'pending',
        matchId: null,
      },
    ],
  };
}

type Bracket = ReturnType<typeof bracket>;
type Result = { ok: true; data: unknown } | { ok: false; kind: 'network' | 'aborted' };

/** The server: each Tournament's saved bracket. A test changes it to play another organiser. */
let saved: Record<string, Bracket | null> = {};
/** What the next POST generate-bracket draws. */
let drawn: Bracket = bracket(false);
/** How many of the next bracket reads fail. */
let failingReads = 0;
/** While set, the next bracket read waits until the test releases it. */
let hold = false;
let release: ((answer: Bracket) => void) | null = null;

const TOURNAMENT_PATH = /^\/api\/v1\/tournaments\/(t\d)(\/bracket|\/registrations)?$/;

function bracketRead(tournamentId: string, signal: AbortSignal | undefined): Promise<Result> {
  if (failingReads > 0) {
    failingReads -= 1;
    return Promise.resolve({ ok: false, kind: 'network' });
  }
  if (!hold) return Promise.resolve({ ok: true, data: saved[tournamentId] ?? null });
  hold = false;
  // As the real client does: an aborted request answers `aborted`, whatever the server says later.
  return new Promise((resolve) => {
    signal?.addEventListener('abort', () => resolve({ ok: false, kind: 'aborted' }));
    release = (answer) => resolve({ ok: true, data: answer });
  });
}

function serve() {
  vi.mocked(apiRequest).mockImplementation(
    async (
      _base: string,
      path: string,
      init?: { method?: string; signal?: AbortSignal | null },
    ) => {
      if (path === '/api/v1/events/ev1/tournaments') {
        return {
          ok: true,
          data: [
            { id: 't1', name: 'Longsword' },
            { id: 't2', name: 'Sabre' },
          ],
        };
      }
      if (path === '/api/v1/events/ev1') return { ok: true, data: { status: 'draft' } };
      if (path === '/api/v1/tournaments/t1/generate-bracket?force=true') {
        saved = { ...saved, t1: drawn };
        return { ok: true, data: drawn };
      }
      if (path === '/api/v1/phases/ph1' && init?.method === 'DELETE') {
        saved = { ...saved, t1: null };
        return { ok: true, data: null };
      }
      const [, tournamentId = '', read] = TOURNAMENT_PATH.exec(path) ?? [];
      if (tournamentId && read === undefined) return { ok: true, data: { weapon: 'longsword' } };
      if (read === '/bracket') {
        return (await bracketRead(tournamentId, init?.signal ?? undefined)) as never;
      }
      if (read === '/registrations') return { ok: true, data: [] };
      if (path === '/api/v1/events/ev1/lices') return { ok: true, data: [] };
      if (path === '/api/v1/events/ev1/referee-skills') return { ok: true, data: [] };
      if (path === '/api/v1/events/ev1/referee-assignment-board') return { ok: true, data: null };
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
  realtime.poll = null;
  saved = { t1: bracket(false) };
  drawn = bracket(false);
  failingReads = 0;
  hold = false;
  release = null;
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
        <ToastProvider>
          <BracketPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

function grandFinalToggle(): HTMLInputElement {
  const boxes = [...container.querySelectorAll('label')]
    .filter((label) => label.textContent?.includes('Grand final reset'))
    .map((label) => label.querySelector('input[type="checkbox"]'));
  expect(boxes).toHaveLength(1);
  return boxes[0] as HTMLInputElement;
}

/** In the whole document: the confirm dialogs render in a portal outside the page. */
function buttons(text: string): HTMLButtonElement[] {
  return [...document.body.querySelectorAll('button')].filter(
    (button) => button.textContent?.trim() === text,
  );
}

async function click(text: string, which: 'first' | 'last' = 'first') {
  const found = buttons(text);
  expect(found.length, `no button "${text}"`).toBeGreaterThan(0);
  await act(async () => (which === 'first' ? found[0] : found.at(-1))!.click());
  await settle();
}

async function poll() {
  expect(realtime.poll, 'the page registered no poll').not.toBeNull();
  await act(async () => realtime.poll!());
  await settle();
}

function bracketReads(): number {
  return vi
    .mocked(apiRequest)
    .mock.calls.filter(([, path]) => path === '/api/v1/tournaments/t1/bracket').length;
}

describe('Bracket page against the 30 s re-read', () => {
  it('a re-read keeps a grand-final-reset tick the operator has not saved', async () => {
    await openPage();
    expect(grandFinalToggle().checked).toBe(false);

    await act(async () => grandFinalToggle().click());
    expect(grandFinalToggle().checked).toBe(true);

    const before = bracketReads();
    await poll();

    expect(bracketReads()).toBe(before + 1);
    expect(grandFinalToggle().checked).toBe(true);
  });

  it('a re-read still brings a value another organiser saved', async () => {
    await openPage();
    expect(grandFinalToggle().checked).toBe(false);

    saved = { t1: bracket(true) };
    await poll();

    expect(grandFinalToggle().checked).toBe(true);
  });

  it('choosing another Tournament shows that Tournament’s saved value, even the same one', async () => {
    saved = { t1: bracket(true), t2: bracket(true) };
    await openPage();
    expect(grandFinalToggle().checked).toBe(true);

    await click('Sabre');

    expect(grandFinalToggle().checked).toBe(true);
  });

  it('a regenerated podium is the saved one a later re-read is compared with', async () => {
    await openPage();
    expect(grandFinalToggle().checked).toBe(false);

    drawn = bracket(true);
    // The re-read after the draw fails, so only the draw's own answer tells the form.
    failingReads = 1;
    await click('Regenerate bracket');
    await click('Yes, regenerate');
    expect(grandFinalToggle().checked).toBe(true);

    // Another organiser switches the reset back off.
    saved = { t1: bracket(false) };
    await poll();

    expect(grandFinalToggle().checked).toBe(false);
  });

  it('a re-read on its way when the bracket is regenerated does not undo the draw', async () => {
    await openPage();
    const before = saved.t1!;

    hold = true;
    await poll();
    drawn = bracket(true);
    await click('Regenerate bracket');
    await click('Yes, regenerate');
    // The read started before the draw answers with the bracket as it was then.
    await act(async () => release?.(before));
    await settle();

    expect(grandFinalToggle().checked).toBe(true);
  });

  it('a bracket deleted by another organiser leaves this page at the next re-read', async () => {
    await openPage();
    expect(buttons('Regenerate bracket')).toHaveLength(1);

    saved = { t1: null };
    await poll();

    expect(buttons('Regenerate bracket')).toHaveLength(0);
    expect(buttons('Generate bracket').length).toBeGreaterThan(0);
  });

  it('a re-read on its way when the bracket is deleted does not bring it back', async () => {
    await openPage();
    const before = saved.t1!;

    hold = true;
    await poll();
    await click('Delete bracket');
    await click('Delete bracket', 'last');
    // The read started before the delete answers with the bracket as it was then.
    await act(async () => release?.(before));
    await settle();

    expect(buttons('Regenerate bracket')).toHaveLength(0);
  });
});
