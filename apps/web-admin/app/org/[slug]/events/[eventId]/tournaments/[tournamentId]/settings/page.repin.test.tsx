import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import type { RulesExpected } from '@myclash/types';
import { openEventPage, type, type OpenedPage } from '../../../archived-page.fixtures';
import { button, TOURNAMENT_ID, TOURNAMENT_READS, TOURNAMENT_ROW } from './page.fixtures';
import TournamentSettingsPage from './page';

/**
 * The audited re-pin on the Basics tab (the audited settings change, revision 12): a ruleset
 * change refused because bouts were fought opens the dialog. It shows what changes, opens its
 * confirm only on the typed name of the Tournament as stored, sends the typed name and the RAW
 * rules the tab last read or saved (`expected`), and says the reload words when the rules moved
 * since.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', tournamentId: 't-1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments/t-1/settings',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const TOURNAMENT = `/api/v1/tournaments/${TOURNAMENT_ID}`;
const REPIN = `${TOURNAMENT}/repin-ruleset`;
const TARGET = 'Generic_PointsCap:1.0.0';

/** The row as stored: rules the server compares, byte for byte, with what the dialog sends. */
const ROW = {
  ...TOURNAMENT_ROW,
  ruleset_config: { pointCap: 10, timeLimitsSeconds: { pool: 90 } },
  scoring_config_json: { afterblowMode: 'full', buttons: { clean: [] } },
  penalty_ruleset_version: '1',
};
const READ_EXPECTED: RulesExpected = {
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  rulesetConfig: ROW.ruleset_config,
  scoringConfig: ROW.scoring_config_json,
  penaltyRulesetId: 'pr-1',
  penaltyRulesetVersion: '1',
};

const READS = {
  ...TOURNAMENT_READS,
  [TOURNAMENT]: ROW,
  [`${TOURNAMENT}/repin-preview?rulesetCode=Generic_PointsCap&rulesetVersion=1.0.0`]: {
    fromCode: 'TF_v1',
    toCode: 'Generic_PointsCap',
    diff: {
      grammar: 'changed',
      endConditions: 'changed',
      ranking: 'changed',
      rankingCompatible: false,
    },
    changes: [{ path: 'matchFormat.pointCap', before: 10, after: 5, locked: true }],
  },
  // The way back, asked by the cases that re-pin twice.
  [`${TOURNAMENT}/repin-preview?rulesetCode=TF_v1&rulesetVersion=1.0.0`]: {
    fromCode: 'Generic_PointsCap',
    toCode: 'TF_v1',
    diff: {
      grammar: 'changed',
      endConditions: 'changed',
      ranking: 'changed',
      rankingCompatible: false,
    },
    changes: [],
  },
};

/** The guard's refusal of the plain ruleset change: bouts were fought (no rules-change code). */
const FOUGHT = {
  ok: false,
  kind: 'unauthenticated',
  status: 403,
  detail: 'Matches are already scored.',
  code: 'FORBIDDEN',
  details: null,
} as const;

let page: OpenedPage;
/** Each save the page sent: its method, path and body. */
let saves: Array<{ method: string; path: string; body: unknown }>;
/** What the server answers each save, by `METHOD path`. */
let answers: Record<string, unknown>;

beforeEach(async () => {
  window.history.replaceState(null, '', '/#basics');
  page = await openEventPage(<TournamentSettingsPage />, READS);
  saves = [];
  answers = { [`PATCH ${TOURNAMENT}`]: FOUGHT };
  const reads = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
  vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) => {
    if (!init?.method || init.method === 'GET') return reads(base, path, init);
    saves.push({ method: init.method, path, body: init.body });
    return answers[`${init.method} ${path}`] as Awaited<ReturnType<typeof ApiClient.apiRequest>>;
  });
});
afterEach(() => page.unmount());

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const confirmButton = () => {
  const found = [...(dialog()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === 'Re-pin ruleset',
  );
  expect(found, 'no confirm button').toBeDefined();
  return found!;
};

async function pick(target: string) {
  const picker = [...document.body.querySelectorAll('select')].find((select) =>
    select.querySelector(`option[value="${target}"]`),
  )!;
  await act(async () => type(picker, target));
}

async function askRepin(target = TARGET) {
  await pick(target);
  await act(async () => button('Change ruleset').click());
  await page.settle();
  expect(dialog(), 'the dialog did not open').not.toBeNull();
}

async function fill(reason: string, name: string) {
  const box = dialog()!;
  await act(async () => type(box.querySelector('textarea')!, reason));
  await act(async () => type(box.querySelector('input')!, name));
}

const REASON = 'The cap was set wrong before the pools.';
const repinBody = () => saves.find((s) => s.path === REPIN)?.body as Record<string, unknown>;

describe('the re-pin dialog on the Basics tab', () => {
  it('shows what changes, from the preview, in words', async () => {
    await askRepin();
    expect(dialog()!.textContent).toContain('Point cap: 10 → 5');
  });

  it('opens its confirm only on the typed name of the Tournament', async () => {
    await askRepin();
    await fill(REASON, 'Long sword');
    expect(confirmButton().disabled).toBe(true);
    await fill(REASON, '  LONGSWORD ');
    expect(confirmButton().disabled).toBe(false);
    await fill('Too short', 'Longsword');
    expect(confirmButton().disabled).toBe(true);
  });

  it('sends the typed name and the rules as the tab read them', async () => {
    answers[`POST ${REPIN}`] = {
      ok: true,
      data: { tournament: { ...ROW, ruleset_code: 'Generic_PointsCap' }, rulesetChange: {} },
    };
    await askRepin();
    await fill(REASON, 'longsword');
    await act(async () => confirmButton().click());
    await page.settle();

    expect(repinBody()).toEqual({
      rulesetCode: 'Generic_PointsCap',
      rulesetVersion: '1.0.0',
      justification: REASON,
      confirm: 'longsword',
      expected: READ_EXPECTED,
    });
    expect(dialog()).toBeNull();
  });

  it('sends the rules of the row its own save answered, and asks the name that save wrote', async () => {
    const written = {
      ...ROW,
      name: 'Longsword Open',
      penalty_ruleset_id: 'pr-2',
      penalty_ruleset_version: '3',
    };
    answers[`PATCH ${TOURNAMENT}`] = { ok: true, data: written };
    await act(async () => button('Save changes').click());
    await page.settle();
    answers[`PATCH ${TOURNAMENT}`] = FOUGHT;
    answers[`POST ${REPIN}`] = { ok: true, data: { tournament: written, rulesetChange: {} } };

    await askRepin();
    await fill(REASON, 'Longsword');
    expect(confirmButton().disabled).toBe(true);
    await fill(REASON, 'Longsword Open');
    await act(async () => confirmButton().click());
    await page.settle();

    expect(repinBody()['expected']).toEqual({
      ...READ_EXPECTED,
      penaltyRulesetId: 'pr-2',
      penaltyRulesetVersion: '3',
    });
  });

  it('sends, on a second re-pin, the rules the first one answered', async () => {
    const first = {
      ...ROW,
      ruleset_code: 'Generic_PointsCap',
      ruleset_config: { pointCap: 5 },
      scoring_config_json: { afterblowMode: 'none', buttons: { clean: [] } },
    };
    answers[`POST ${REPIN}`] = { ok: true, data: { tournament: first, rulesetChange: {} } };
    await askRepin();
    await fill(REASON, 'Longsword');
    await act(async () => confirmButton().click());
    await page.settle();

    await askRepin('TF_v1:1.0.0');
    await fill(REASON, 'Longsword');
    await act(async () => confirmButton().click());
    await page.settle();

    const bodies = saves
      .filter((s) => s.path === REPIN)
      .map((s) => s.body as Record<string, unknown>);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!['expected']).toEqual({
      ...READ_EXPECTED,
      rulesetCode: 'Generic_PointsCap',
      rulesetConfig: first.ruleset_config,
      scoringConfig: first.scoring_config_json,
    });
  });

  it('sends the rules a ruleset switch wrote before any bout, on a re-pin after it', async () => {
    const switched = {
      ...ROW,
      ruleset_code: 'Generic_PointsCap',
      ruleset_config: { pointCap: 15 },
      scoring_config_json: { afterblowMode: 'none', buttons: { clean: [] } },
    };
    answers[`PATCH ${TOURNAMENT}`] = { ok: true, data: switched };
    await pick(TARGET);
    await act(async () => button('Change ruleset').click());
    await page.settle();
    answers[`PATCH ${TOURNAMENT}`] = FOUGHT;
    answers[`POST ${REPIN}`] = { ok: true, data: { tournament: switched, rulesetChange: {} } };

    await askRepin('TF_v1:1.0.0');
    await fill(REASON, 'Longsword');
    await act(async () => confirmButton().click());
    await page.settle();

    expect(repinBody()['expected']).toEqual({
      ...READ_EXPECTED,
      rulesetCode: 'Generic_PointsCap',
      rulesetConfig: switched.ruleset_config,
      scoringConfig: switched.scoring_config_json,
    });
  });

  it('says the owner-only words alike for the preview and the confirm', async () => {
    const reads = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      path.includes('/repin-preview') ? FOUGHT : reads(base, path, init),
    );
    await askRepin();
    expect(dialog()!.textContent).toContain(
      'Only an organisation owner or a super-admin can re-pin',
    );
  });

  it('says the reload words when the rules moved since the page read them', async () => {
    answers[`POST ${REPIN}`] = {
      ok: false,
      kind: 'http',
      status: 409,
      detail: 'The rules changed since they were read.',
      code: 'rules_changed_since_read',
      details: null,
      validationErrors: null,
    };
    await askRepin();
    await fill(REASON, 'Longsword');
    await act(async () => confirmButton().click());
    await page.settle();

    expect(dialog()!.textContent).toContain(
      'The rules of this tournament changed since this page read them. Reload the page and check them again.',
    );
  });
});
