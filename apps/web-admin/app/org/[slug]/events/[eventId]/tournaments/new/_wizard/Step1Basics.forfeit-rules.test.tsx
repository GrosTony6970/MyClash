import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import type * as SelectableRulesets from '@/lib/selectable-rulesets';
import { type } from '../../../archived-page.fixtures';
import { FORFEIT_RULES_READ } from '../../[tournamentId]/settings/page.fixtures';
import { Step1Basics } from './Step1Basics';

/**
 * Step 1 of the wizard shows the forfeit rules of the penalty ruleset it picks, and takes the
 * organiser's changes of them (rulings 65, 70): sent with the create, and with a resumed draft's
 * save only when the form changed them. The step is MOUNTED: its reads start in effects.
 */
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ orgId: 'org-a' }),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('@/lib/selectable-rulesets', async (importOriginal) => ({
  ...(await importOriginal<typeof SelectableRulesets>()),
  fetchSelectableRulesets: async () => [{ code: 'TF_v1', version: '1', label: 'TF v1' }],
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const DRAFT = '/api/v1/tournaments/t1';
/** A resumed draft that changed one rule: a voluntary withdrawal is a loss to 37 (a MARKER). */
const DRAFT_ROW = {
  name: 'Longsword',
  slug: 'longsword',
  weapon: null,
  ruleset_code: 'TF_v1',
  ruleset_version: '1',
  penalty_ruleset_id: 'p-builtin',
  forfeit_rules: { reasons: { voluntary: { opponentScore: 37 } } },
};

const READS: Record<string, unknown> = {
  '/api/v1/organizations/org-a/penalty-rulesets': [
    { id: 'p-builtin', name: 'FFAMHE penalties', built_in: true },
  ],
  '/api/v1/events/ev1/forfeit-rules': FORFEIT_RULES_READ,
  '/api/v1/events/ev1/forfeit-rules?penaltyRulesetId=p-builtin': FORFEIT_RULES_READ,
  [`${DRAFT}/forfeit-rules`]: FORFEIT_RULES_READ,
  [DRAFT]: DRAFT_ROW,
};

/** Every save the step sent: its method, path and body. */
const sent: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

function serve() {
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method && init.method !== 'GET') {
      sent.push({ method: init.method, path, body: init.body as Record<string, unknown> });
      return { ok: true, data: { id: 't1' } };
    }
    if (path in READS) return { ok: true, data: READS[path] };
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
  sent.length = 0;
  serve();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openStep(initialTournamentId: string | null, locale: 'en' | 'fr' = 'en') {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ToastProvider>
          <Step1Basics
            eventId="ev1"
            initialTournamentId={initialTournamentId}
            onCreated={() => {}}
            readOnly={false}
          />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

function field(id: string) {
  const found = container.querySelector<HTMLInputElement>(`[data-testid="forfeit-${id}"]`);
  expect(found, `no forfeit field ${id}`).not.toBeNull();
  return found!;
}
const badged = (id: string) =>
  field(id).closest('label')!.parentElement!.textContent?.includes('modified') ?? false;

async function next() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-testid="tournament-create"]')!.click(),
  );
  await settle();
}

describe('the forfeit rules in Step 1 of the wizard', () => {
  it('a new Tournament: shows the picked ruleset’s rules, and sends a change with the create', async () => {
    await openStep(null);
    await act(async () =>
      type(container.querySelector('[data-testid="tournament-name"]')!, 'Sabre'),
    );
    expect(field('injury-score').value).toBe('6');
    await act(async () => type(field('injury-score'), '41'));
    expect(badged('injury-score')).toBe(true);
    await next();

    expect(sent).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          forfeitRules: { reasons: { injury: { opponentScore: 41 } } },
        }),
      }),
    ]);
  });

  it('a resumed draft: shows its change badged, and an untouched save keeps it', async () => {
    await openStep('t1');

    expect(field('voluntary-score').value).toBe('37');
    expect(badged('voluntary-score')).toBe(true);
    await next();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe('PATCH');
    expect(JSON.parse(JSON.stringify(sent[0]!.body))).not.toHaveProperty('forfeitRules');
  });

  it('a draft that cannot be read: the None rules show, not a Loading line for good', async () => {
    const serveReads = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
      path === DRAFT
        ? ({
            ok: false,
            kind: 'http',
            status: 404,
            detail: 'Tournament t1 not found',
            code: null,
            details: null,
            validationErrors: null,
          } as Awaited<ReturnType<typeof apiRequest>>)
        : serveReads(base, path, init),
    );
    await openStep('t1');

    expect(field('injury-score').value).toBe('6');
  });

  it.each([
    ['en', 'A bout of this tournament has started: its forfeit rules are locked.'],
    ['fr', 'Un assaut de ce tournoi a commencé : ses règles de forfait sont verrouillées.'],
  ] as const)(
    'a resumed draft: says in %s why a change is refused once a bout has started',
    async (locale, sentence) => {
      const serveReads = vi.mocked(apiRequest).getMockImplementation()!;
      vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
        init?.method === 'PATCH'
          ? ({
              ok: false,
              kind: 'unauthenticated',
              status: 403,
              detail: 'This tournament has scored matches, so its forfeit rules are locked.',
              code: 'forfeit_rules_locked',
              details: null,
            } as Awaited<ReturnType<typeof apiRequest>>)
          : serveReads(base, path, init),
      );
      await openStep('t1', locale);
      await act(async () => type(field('injury-score'), '41'));
      await next();

      expect(document.body.textContent).toContain(sentence);
    },
  );
});
