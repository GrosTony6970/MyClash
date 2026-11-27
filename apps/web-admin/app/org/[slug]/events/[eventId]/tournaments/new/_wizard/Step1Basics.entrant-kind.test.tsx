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
 * Step 1's first choice: individual Fighters or teams (Team Tournaments, slice 1b-1). A team
 * Tournament has no waitlist and takes no forfeit rules, so the step hides both and does not send
 * them; it sends its kind and its default team size. A resumed draft keeps its kind, and once it
 * holds an entrant the choice is closed, with the reason, and not sent.
 */
const context = vi.hoisted(() => ({ refetchEvents: vi.fn(async () => {}) }));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ orgId: 'org-a', refetchEvents: context.refetchEvents }),
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
vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'org', eventId: 'ev1' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const DRAFT = '/api/v1/tournaments/t1';
/** A resumed team draft with no entrant yet. */
const TEAM_DRAFT = {
  name: 'Team Longsword',
  slug: 'team-longsword',
  weapon: null,
  ruleset_code: 'TF_v1',
  ruleset_version: '1',
  penalty_ruleset_id: 'p-builtin',
  forfeit_rules: null,
  max_participants: 8,
  max_waitlist: null,
  entrant_kind: 'team',
  team_default_size: 4,
  entrant_count: 0,
};

let draft: Record<string, unknown> = TEAM_DRAFT;
/** The answer of the step's save, when the server refuses it. */
let refusal: Awaited<ReturnType<typeof apiRequest>> | null = null;
const sent: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

function serve() {
  const reads: Record<string, unknown> = {
    '/api/v1/organizations/org-a/penalty-rulesets': [
      { id: 'p-builtin', name: 'FFAMHE penalties', built_in: true },
    ],
    '/api/v1/events/ev1/forfeit-rules': FORFEIT_RULES_READ,
    '/api/v1/events/ev1/forfeit-rules?penaltyRulesetId=p-builtin': FORFEIT_RULES_READ,
    [`${DRAFT}/forfeit-rules`]: FORFEIT_RULES_READ,
    [DRAFT]: draft,
  };
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method && init.method !== 'GET') {
      // As the wire carries it: an undefined field is not sent.
      sent.push({ method: init.method, path, body: JSON.parse(JSON.stringify(init.body)) });
      return refusal ?? { ok: true, data: { id: 't1' } };
    }
    if (path in reads) return { ok: true, data: reads[path] };
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
  context.refetchEvents.mockClear();
  sent.length = 0;
  draft = TEAM_DRAFT;
  refusal = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openStep(initialTournamentId: string | null) {
  serve();
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
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

const q = <T extends Element>(selector: string) => container.querySelector<T>(selector);
const radio = (kind: string) => q<HTMLInputElement>(`input[name="entrant-kind"][value="${kind}"]`)!;
const input = (label: string) => q<HTMLInputElement>(`input[aria-label="${label}"]`);
const forfeitBlock = () => q('[data-testid="forfeit-injury-score"]');

async function pick(kind: string) {
  await act(async () => radio(kind).click());
}
async function fill(selector: string, value: string) {
  await act(async () => type(q<HTMLInputElement>(selector)!, value));
}
async function next() {
  await act(async () => q<HTMLButtonElement>('[data-testid="tournament-create"]')!.click());
  await settle();
}

describe('the kind of entrant in Step 1 of the wizard', () => {
  it('a team Tournament sends its kind and size, and no waitlist cap nor forfeit rules', async () => {
    await openStep(null);
    await fill('[data-testid="tournament-name"]', 'Team Longsword');
    // Typed while individual, then hidden by the switch: neither is sent.
    await act(async () => type(input('Max waitlist')!, '5'));
    await fill('[data-testid="forfeit-injury-score"]', '41');
    await pick('team');
    await fill('[data-testid="team-default-size"]', '3');
    await act(async () => type(input('Max teams')!, '8'));

    expect(input('Max waitlist')).toBeNull();
    expect(forfeitBlock()).toBeNull();
    expect(container.textContent).toContain('The automatic forfeit rules do not act on teams.');
    await next();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe('POST');
    expect(sent[0]!.body).toEqual({
      name: 'Team Longsword',
      slug: 'team-longsword',
      rulesetCode: 'TF_v1',
      rulesetVersion: '1',
      penaltyRulesetId: 'p-builtin',
      maxParticipants: 8,
      entrantKind: 'team',
      teamDefaultSize: 3,
    });
    expect(context.refetchEvents).toHaveBeenCalledTimes(1);
  });

  it('an individual Tournament sends the body it always did, with no kind', async () => {
    await openStep(null);
    expect(radio('individual').checked).toBe(true);
    await fill('[data-testid="tournament-name"]', 'Sabre');
    await act(async () => type(input('Max participants')!, '16'));
    await act(async () => type(input('Max waitlist')!, '5'));
    await fill('[data-testid="forfeit-injury-score"]', '41');
    await next();

    expect(sent[0]!.body).toEqual({
      name: 'Sabre',
      slug: 'sabre',
      rulesetCode: 'TF_v1',
      rulesetVersion: '1',
      penaltyRulesetId: 'p-builtin',
      forfeitRules: { reasons: { injury: { opponentScore: 41 } } },
      maxParticipants: 16,
      maxWaitlist: 5,
    });
    expect(context.refetchEvents).toHaveBeenCalledTimes(1);
  });

  it('a resumed draft switched back to individual sends that kind, and its waitlist', async () => {
    await openStep('t1');
    await pick('individual');
    await act(async () => type(input('Max waitlist')!, '2'));
    await next();
    expect(sent[0]!.body).toMatchObject({ entrantKind: 'individual', maxWaitlist: 2 });
    expect(sent[0]!.body).not.toHaveProperty('teamDefaultSize');
  });

  it('a resumed team draft keeps its kind and its size, and saves the size alone', async () => {
    await openStep('t1');
    expect(radio('team').checked).toBe(true);
    expect(radio('team').disabled).toBe(false);
    expect(q<HTMLInputElement>('[data-testid="team-default-size"]')!.value).toBe('4');
    expect(input('Max teams')!.value).toBe('8');
    await next();

    expect(sent[0]!.method).toBe('PATCH');
    expect(sent[0]!.body).toEqual({
      name: 'Team Longsword',
      weapon: null,
      rulesetCode: 'TF_v1',
      rulesetVersion: '1',
      penaltyRulesetId: 'p-builtin',
      color: null,
      maxParticipants: 8,
      teamDefaultSize: 4,
    });
    expect(context.refetchEvents).toHaveBeenCalledTimes(1);
  });

  it('a resumed draft that holds entrants closes the choice, says why, and sends no kind', async () => {
    draft = { ...TEAM_DRAFT, entrant_count: 2 };
    await openStep('t1');
    expect(radio('team').checked).toBe(true);
    expect(radio('team').disabled).toBe(true);
    expect(radio('individual').disabled).toBe(true);
    expect(container.textContent).toContain(
      'This tournament already has entrants, so its kind cannot change.',
    );
    await next();
    expect(sent[0]!.body).not.toHaveProperty('entrantKind');
    expect(sent[0]!.body).toHaveProperty('teamDefaultSize', 4);
  });

  it('a draft that gained an entrant since it was read says the kind is fixed now', async () => {
    refusal = {
      ok: false,
      kind: 'http',
      status: 409,
      detail: 'This Tournament holds entrants, so its kind cannot change.',
      code: 'CONFLICT',
      details: { reason: 'entrant_kind_settled' },
      validationErrors: null,
    } as Awaited<ReturnType<typeof apiRequest>>;
    await openStep('t1');
    await pick('individual');
    await next();
    expect(document.body.textContent).toContain(
      'This tournament has entrants now, so its kind cannot change.',
    );
    expect(context.refetchEvents).not.toHaveBeenCalled();
  });

  /** The save's 409, as the API's error filter puts a kind trigger's refusal on the wire. */
  const refusedWith = (reason: string) =>
    ({
      ok: false,
      kind: 'http',
      status: 409,
      detail: 'An English sentence from the API.',
      code: 'CONFLICT',
      details: { reason },
      validationErrors: null,
    }) as Awaited<ReturnType<typeof apiRequest>>;

  it('a draft whose Pools were drawn elsewhere says to delete them first (ruling 989)', async () => {
    refusal = refusedWith('kind_locked_by_phase');
    await openStep('t1');
    await pick('individual');
    await next();
    expect(document.body.textContent).toContain(
      'Delete the Pools and the bracket first: a tournament keeps its kind once it has Pools or a bracket.',
    );
    expect(document.body.textContent).not.toContain('Update failed');
    expect(context.refetchEvents).not.toHaveBeenCalled();
  });

  it('a draft linked to a League elsewhere says to remove the link first (ruling 981)', async () => {
    draft = { ...TEAM_DRAFT, entrant_kind: 'individual', team_default_size: null };
    refusal = refusedWith('league_link_blocks_team');
    await openStep('t1');
    await pick('team');
    await next();
    expect(document.body.textContent).toContain(
      'Remove the League link first: League points belong to persons.',
    );
    expect(document.body.textContent).not.toContain('Update failed');
    expect(context.refetchEvents).not.toHaveBeenCalled();
  });
});
