import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import type { RulesChange } from '@myclash/types';
import { type } from '../../../archived-page.fixtures';
import { control } from './page.rules.fixtures';
import {
  audited,
  confirmWith,
  dialog,
  expectedOf,
  fighter,
  needsAudit,
  openRules,
  pressButton,
  refusedWith,
  STARTED_ROW,
  TOURNAMENT,
  type OpenedRules,
} from './page.rules-change.fixtures';

/**
 * The rules-change dialog on the Basics tab (the audited settings change, commit 5c; rulings 143,
 * 151, 161, 163, 169; revision 15 fold 6, revision 18 fold 6, Pass 6 items 1 and 3). A forfeit
 * change on a started Tournament opens it with the Fighters it moves; the resend carries the
 * forfeit rules alone, so a name typed beside stays to be saved; `expected` is the last row the
 * tab knew, a late read of it dropped.
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

type Answer = Awaited<ReturnType<typeof ApiClient.apiRequest>>;

let opened: OpenedRules;
afterEach(() => opened.page.unmount());

const DISQUALIFY: RulesChange = {
  path: 'forfeitRules.disqualifyAfter',
  before: 'off',
  after: 2,
  locked: true,
};
const PAUL = fighter('reg-901', 'Paul Martin', 'checked_in', 'disqualified');
const AFTER = { ...STARTED_ROW, forfeit_rules: { disqualifyAfter: 2 } };
const save = () => pressButton(opened, 'Save changes');
const pageText = () => document.body.textContent ?? '';

async function setForfeitScore(value: string) {
  const box = document.body.querySelector<HTMLInputElement>('[data-testid="forfeit-injury-score"]');
  expect(box, 'no forfeit score field').not.toBeNull();
  await act(async () => type(box!, value));
}
async function setName(value: string) {
  await act(async () => type(control('Name'), value));
}

describe('a forfeit change on a started Tournament', () => {
  it('opens the dialog with the Fighters it moves, in the roster’s words (rulings 163, 169)', async () => {
    opened = await openRules('basics');
    opened.patches.push(needsAudit([DISQUALIFY], [PAUL]));
    await setForfeitScore('41');
    await save();

    const items = [...(dialog()?.querySelectorAll('li') ?? [])].map((li) => li.textContent);
    expect(items).toContain('Paul Martin: Checked in → Disqualified');
    expect(dialog()!.textContent).toContain('The Fighters named below change status at once.');
    expect(pageText()).not.toContain('reg-901');
  });

  it('resends the forfeit rules alone with the audit; a name typed beside stays to be saved (ruling 151)', async () => {
    opened = await openRules('basics');
    opened.patches.push(needsAudit([DISQUALIFY], [PAUL]), audited(AFTER));
    await setName('Longsword Open');
    await setForfeitScore('41');
    await save();
    await confirmWith(opened);

    const [first, resend] = opened.saves;
    expect(Object.keys(resend!.body).sort()).toEqual(['audit', 'forfeitRules']);
    expect(resend!.body['forfeitRules']).toEqual(first!.body['forfeitRules']);
    expect(resend!.body['audit']).toMatchObject({ expected: expectedOf(STARTED_ROW) });
    expect((control('Name') as HTMLInputElement).value).toBe('Longsword Open');

    await save();
    expect(opened.saves[2]!.body['name']).toBe('Longsword Open');
    expect(opened.saves[2]!.body).not.toHaveProperty('forfeitRules');
  });

  it('marks the forfeit rules alone saved: with a name typed beside, leaving the tab asks first', async () => {
    opened = await openRules('basics');
    opened.patches.push(needsAudit([DISQUALIFY]), audited(AFTER));
    await setName('Longsword Open');
    await setForfeitScore('41');
    await save();
    await confirmWith(opened);
    expect(dialog()).toBeNull();

    await pressButton(opened, 'Display');
    expect(dialog(), 'leaving did not ask').not.toBeNull();
  });

  it('and with nothing typed beside, leaving the tab asks nothing (the twin)', async () => {
    opened = await openRules('basics');
    opened.patches.push(needsAudit([DISQUALIFY]), audited(AFTER));
    await setForfeitScore('41');
    await save();
    await confirmWith(opened);

    await pressButton(opened, 'Display');
    expect(dialog()).toBeNull();
  });

  it('opens no dialog for a card pin locked with it: the card words (a guard)', async () => {
    opened = await openRules('basics');
    opened.patches.push(refusedWith(403, 'card_change_locked'));
    await setForfeitScore('41');
    await save();
    expect(dialog()).toBeNull();
    expect(pageText()).toContain('its card rules are locked');
  });

  it.each([
    ['changes', 'Reset each change below, then save.'],
    ['ruleset', 'Fix the penalty ruleset.'],
  ])('says why rules that cannot be read refuse it (cause %s)', async (cause, words) => {
    opened = await openRules('basics');
    opened.patches.push(refusedWith(409, 'forfeit_rules_invalid', { cause }));
    await setForfeitScore('41');
    await save();
    expect(pageText()).toContain(words);
    expect(pageText()).not.toContain('An English sentence.');
  });
});

describe('the rules the next audit sends back', () => {
  it('after a save that could not read its row back: what the read again answered', async () => {
    const read = {
      ...STARTED_ROW,
      forfeit_rules: { disqualifyAfter: 2, blackCardOpponentScore: 6 },
    };
    opened = await openRules('basics');
    opened.gets.push({ ok: true, data: read } as Answer);
    opened.patches.push(needsAudit([DISQUALIFY]), audited(null), needsAudit([DISQUALIFY]));
    await setForfeitScore('41');
    await save();
    await confirmWith(opened);
    await setForfeitScore('43');
    await save();
    await confirmWith(opened);

    expect(opened.saves[3]!.body['audit']).toMatchObject({ expected: expectedOf(read) });
  });

  it('a later save wins over that read when it answers late (Pass 6 item 3)', async () => {
    let answerRead!: (answer: Answer) => void;
    opened = await openRules('basics');
    opened.gets.push(new Promise<Answer>((resolve) => (answerRead = resolve)));
    const saved = { ...STARTED_ROW, name: 'Longsword Open', forfeit_rules: { disqualifyAfter: 2 } };
    opened.patches.push(
      needsAudit([DISQUALIFY]),
      audited(null),
      { ok: true, data: saved } as Answer,
      needsAudit([DISQUALIFY]),
    );
    await setForfeitScore('41');
    await save();
    await confirmWith(opened);
    await setName('Longsword Open');
    await save();
    await act(async () =>
      answerRead({ ok: true, data: { ...STARTED_ROW, forfeit_rules: null } } as Answer),
    );
    await opened.page.settle();
    await setForfeitScore('43');
    await save();
    await confirmWith(opened, 'Longsword Open');

    expect(opened.saves, 'the dialog sent no audit').toHaveLength(5);
    expect(opened.saves[4]!.body['audit']).toMatchObject({ expected: expectedOf(saved) });
  });
});

describe('a ruleset change refused', () => {
  async function askChange() {
    const picker = [...document.body.querySelectorAll('select')].find((select) =>
      select.querySelector('option[value="Generic_PointsCap:1.0.0"]'),
    )!;
    await act(async () => type(picker, 'Generic_PointsCap:1.0.0'));
    await pressButton(opened, 'Change ruleset');
  }

  it('opens the re-pin on the coded refusal only: an uncoded 403 is said', async () => {
    const preview = `${TOURNAMENT}/repin-preview?rulesetCode=Generic_PointsCap&rulesetVersion=1.0.0`;
    const diff = {
      grammar: 'same',
      endConditions: 'same',
      ranking: 'same',
      rankingCompatible: true,
    };
    opened = await openRules('basics', STARTED_ROW, {
      [preview]: { fromCode: 'TF_v1', toCode: 'Generic_PointsCap', diff, changes: [] },
    });
    opened.patches.push(refusedWith(403, 'FORBIDDEN'), needsAudit([]));
    await askChange();
    expect(dialog()).toBeNull();
    expect(pageText()).toContain('An English sentence.');
    await askChange();
    expect(dialog()).not.toBeNull();
  });
});
