import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import { FFAMHE_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { FORBIDDEN_READ, type } from '../../../archived-page.fixtures';
import { button } from './page.fixtures';
import { control, openTab, type OpenedTab } from './page.rules.fixtures';

/**
 * The Basics tab shows the forfeit rules the Tournament plays (rulings 65, 70): its penalty
 * ruleset's, read for the pick on screen, with the Tournament's own changes laid over them, each
 * badged with a Reset. Its one Save sends the changes the form made (`patchOf`), and its one
 * dirty report covers them. Every case holds a MARKER value no start value holds.
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

const OWN = '/api/v1/tournaments/t-1/forfeit-rules';
const PICK_2 = `${OWN}?penaltyRulesetId=pr-2`;
const NONE = '/api/v1/events/ev1/forfeit-rules';

/** A read's answer: the built-in's rules and cards, with `over` laid on. */
const rulesOf = (over: Record<string, unknown> = {}) => {
  const ruleset = {
    ...FFAMHE_FORFEIT_RULES,
    firstBlackCard: 'match',
    secondBlackCard: 'tournament',
    ...over,
  };
  return { ruleset, changes: null, inForce: ruleset };
};
/** The Tournament's MARKER change: a voluntary withdrawal is a loss to 37. */
const STORED = { reasons: { voluntary: { opponentScore: 37 } } };
/** Léa's read of the Tournament: she scores for the club and is not its admin. */
const LEAS = { viewer_may_edit: false };

let opened: OpenedTab;
afterEach(() => opened.page.unmount());

function open(
  stored: unknown = STORED,
  reads: Record<string, unknown> = {},
  row: Record<string, unknown> = {},
) {
  return openTab('basics', {
    row: { forfeit_rules: stored, ...row },
    reads: { [PICK_2]: rulesOf({ disqualifyAfter: 7 }), ...reads },
  });
}

function field(id: string) {
  const found = document.body.querySelector<HTMLInputElement & HTMLSelectElement>(
    `[data-testid="forfeit-${id}"]`,
  );
  expect(found, `no forfeit field ${id}`).not.toBeNull();
  return found!;
}
/** The field's own box: its badge and its Reset are there. */
const boxOf = (id: string) => field(id).closest('label')!.parentElement!;
const badged = (id: string) => boxOf(id).textContent?.includes('modified') ?? false;
const pick = () => control('Penalty ruleset') as HTMLSelectElement;
const sentForfeit = () => (opened.saved.at(-1) as Record<string, unknown>)['forfeitRules'];
const asked = () => document.body.querySelector('[role="dialog"]') !== null;
/** Taps the Display tab, as the organiser leaves Basics: the page asks first if it is dirty. */
async function leave() {
  await act(async () => button('Display').click());
  await opened.page.settle();
}

async function set(id: string, value: string) {
  await act(async () => type(field(id), value));
  await opened.page.settle();
}
async function choose(id: string) {
  await act(async () => type(pick(), id));
  await opened.page.settle();
}
async function reset(id: string) {
  const link = [...boxOf(id).querySelectorAll('button')].find((b) => b.textContent === 'Reset');
  expect(link, `no Reset by ${id}`).toBeDefined();
  await act(async () => link!.click());
}
async function save() {
  await act(async () => button('Save changes').click());
  await opened.page.settle();
}

describe('the forfeit rules on the Basics tab', () => {
  it('show the ruleset’s rules under the Tournament’s change, badged', async () => {
    opened = await open();

    expect(field('voluntary-score').value).toBe('37');
    expect(badged('voluntary-score')).toBe(true);
    expect(field('injury-score').value).toBe('6');
    expect(badged('injury-score')).toBe(false);
    // It waited for the row: no read was made for the pick the tab showed before it.
    const paths = vi.mocked(ApiClient.apiRequest).mock.calls.map(([, path]) => path);
    expect(paths).not.toContain(NONE);
  });

  it('send no forfeit change with a Save of the name only, and keep the stored one', async () => {
    opened = await open();
    await act(async () => type(control('Name'), 'Longsword open'));
    await save();

    expect(opened.saved.at(-1)).not.toHaveProperty('forfeitRules');
    expect(badged('voluntary-score')).toBe(true);
  });

  it('send an edit, and only it', async () => {
    opened = await open();
    await set('injury-score', '41');
    await save();

    expect(sentForfeit()).toEqual({ reasons: { injury: { opponentScore: 41 } } });
  });

  it('Reset a stored change: the ruleset’s value, a null sent, and the tab clean after Save', async () => {
    opened = await open();
    await reset('voluntary-score');

    expect(field('voluntary-score').value).toBe('6');
    expect(badged('voluntary-score')).toBe(false);
    await save();
    expect(sentForfeit()).toEqual({ reasons: { voluntary: { opponentScore: null } } });
    await leave();
    expect(asked()).toBe(false);
    expect(window.location.hash).toBe('#display');
  });

  it('Reset an edit not saved: the ruleset’s value, and nothing to save', async () => {
    opened = await open();
    await set('injury-score', '41');
    await reset('injury-score');

    expect(field('injury-score').value).toBe('6');
    await leave();
    expect(asked()).toBe(false);
    expect(window.location.hash).toBe('#display');
  });

  it('ask before a tab switch throws an edit of a forfeit field away', async () => {
    opened = await open();
    await set('injury-score', '41');
    await leave();

    expect(asked()).toBe(true);
  });

  it('keep the changes when the pick changes, over the picked ruleset’s rules', async () => {
    opened = await open();
    await choose('pr-2');

    expect(field('disqualify-after').value).toBe('7');
    expect(field('voluntary-score').value).toBe('37');
    expect(badged('voluntary-score')).toBe(true);
  });

  it('show the Event’s rules for None, not the pin’s (13b)', async () => {
    opened = await open(STORED, { [NONE]: rulesOf({ disqualifyAfter: 9 }) });
    await choose('');

    expect(field('disqualify-after').value).toBe('9');
    // An admin's: the rules stay live.
    expect(field('disqualify-after').matches(':disabled')).toBe(false);
  });

  it('show a non-admin the Event’s rules for None, read-only (13c, ruling 90)', async () => {
    opened = await open(STORED, { [NONE]: rulesOf({ disqualifyAfter: 9 }) }, LEAS);

    expect(field('voluntary-score').matches(':disabled')).toBe(true);
    expect(boxOf('voluntary-score').textContent).not.toContain('Reset');
    const before = vi.mocked(ApiClient.apiRequest).mock.calls.length;
    await choose('');

    // The rules shown are the None read's, made for this pick.
    const after = vi.mocked(ApiClient.apiRequest).mock.calls.slice(before);
    expect(after.map(([, path]) => path)).toContain(NONE);
    expect(field('disqualify-after').value).toBe('9');
    expect(field('disqualify-after').matches(':disabled')).toBe(true);
  });

  it('show a non-admin the pinned rules, read-only, when the pick’s read is refused', async () => {
    opened = await open(STORED, { [PICK_2]: FORBIDDEN_READ });
    await choose('pr-2');

    expect(field('disqualify-after').value).toBe('2');
    expect(field('injury-score').matches(':disabled')).toBe(true);
    expect(document.body.textContent).toContain('these are the pinned ruleset’s');
    // The positive twin: the pinned pick's own read leaves the block live.
    await choose('pr-1');
    expect(field('injury-score').matches(':disabled')).toBe(false);
  });

  it('drop an answer made for a pick no longer on screen', async () => {
    opened = await open();
    let release!: () => void;
    const late = new Promise<void>((resolve) => (release = resolve));
    const read = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) => {
      if (path === PICK_2) await late;
      return read(base, path, init);
    });
    await choose('pr-2');
    // The pick on screen has no answer yet: the block shows no rules, not the last pick's.
    expect(document.body.querySelector('[data-testid="forfeit-disqualify-after"]')).toBeNull();
    await choose('pr-1');
    await act(async () => release());
    await opened.page.settle();

    expect(field('disqualify-after').value).toBe('2');
  });

  it('send a card changed with its select', async () => {
    opened = await open(null);
    await set('secondBlackCard', 'match');

    expect(badged('secondBlackCard')).toBe(true);
    await save();
    expect(sentForfeit()).toEqual({ secondBlackCard: 'match' });
  });

  it('show a card change and save it; its Reset shows the ruleset’s card', async () => {
    opened = await open({ secondBlackCard: 'none' });

    expect(field('secondBlackCard').value).toBe('none');
    expect(badged('secondBlackCard')).toBe(true);
    await reset('secondBlackCard');
    expect(field('secondBlackCard').value).toBe('tournament');
    await save();
    expect(sentForfeit()).toEqual({ secondBlackCard: null });
  });

  it('open the rules-change dialog once a bout has started (5c)', async () => {
    opened = await open();
    const read = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      init?.method === 'PATCH'
        ? ({
            ok: false,
            kind: 'unauthenticated',
            status: 403,
            detail: 'This tournament has started: these rules need the audit.',
            code: 'rules_change_needs_audit',
            details: {
              changes: [
                {
                  path: 'forfeitRules.reasons.injury.opponentScore',
                  before: 6,
                  after: 41,
                  locked: true,
                },
              ],
              fighters: [],
            },
          } as Awaited<ReturnType<typeof ApiClient.apiRequest>>)
        : read(base, path, init),
    );
    await set('injury-score', '41');
    await save();

    expect(asked()).toBe(true);
    expect(document.body.textContent).not.toContain('these rules need the audit');
  });

  it('say the stored rules cannot be read, and Reset the stored change', async () => {
    const broken = { secondBlackCard: 'foo' };
    opened = await open(broken, {
      [OWN]: { ...rulesOf(), changes: broken, inForce: null, invalid: 'forfeit_rules_invalid' },
    });

    const CHANGES_BROKEN = 'The forfeit rules of this tournament cannot be read.';
    expect(document.body.textContent).toContain(CHANGES_BROKEN);
    const link = [...document.body.querySelectorAll('li button')].find(
      (b) => b.textContent === 'Reset',
    );
    expect(link).toBeDefined();
    await act(async () => (link as HTMLButtonElement).click());
    // Reset, not yet saved: still the Tournament's change that is broken, never the ruleset.
    expect(document.body.textContent).toContain(CHANGES_BROKEN);
    expect(document.body.textContent).not.toContain('Fix the penalty ruleset');
    const ownReads = () => vi.mocked(ApiClient.apiRequest).mock.calls.filter(([, p]) => p === OWN);
    const before = ownReads().length;
    await save();
    expect(sentForfeit()).toEqual({ secondBlackCard: null });
    // The Save changed what is stored: the block reads the rules again.
    expect(ownReads().length).toBeGreaterThan(before);
  });

  it('after a saved Reset, send no forfeit change with the next Save of the name only', async () => {
    opened = await open();
    await reset('voluntary-score');
    await save();
    await act(async () => type(control('Name'), 'Longsword open'));
    await save();

    expect(opened.saved).toHaveLength(2);
    expect(opened.saved.at(-1)).not.toHaveProperty('forfeitRules');
  });

  it('after a saved Reset, an edit then its Reset leave nothing to save', async () => {
    opened = await open();
    await reset('voluntary-score');
    await save();
    await set('voluntary-score', '20');
    await reset('voluntary-score');
    await leave();

    expect(asked()).toBe(false);
    expect(window.location.hash).toBe('#display');
  });

  it('say the penalty ruleset’s own rules cannot be read, which no Reset here fixes', async () => {
    opened = await open(STORED, {
      [OWN]: { ruleset: null, changes: STORED, inForce: null, invalid: 'forfeit_rules_invalid' },
    });

    expect(document.body.textContent).toContain('Fix the penalty ruleset.');
  });

  it('show no badge on a Tournament that stores no change (a saved Reset, read again)', async () => {
    opened = await open(null);

    expect(badged('voluntary-score')).toBe(false);
    expect(field('voluntary-score').value).toBe('6');
  });

  // A read that does not say whether its reader may edit: the block stays live, and a non-admin
  // learns from the Save's 403 (the server's own sentence).
  it('stay live on load, and say why a Save is refused for want of a role', async () => {
    opened = await open(STORED, {}, { viewer_may_edit: undefined });
    const read = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      init?.method === 'PATCH'
        ? ({
            ok: false,
            kind: 'unauthenticated',
            status: 403,
            detail: 'Requires admin role or higher',
            code: null,
            details: null,
          } as Awaited<ReturnType<typeof ApiClient.apiRequest>>)
        : read(base, path, init),
    );

    expect(field('injury-score').matches(':disabled')).toBe(false);
    await set('injury-score', '41');
    await save();
    expect(document.body.textContent).toContain('Requires admin role or higher');
  });
});
