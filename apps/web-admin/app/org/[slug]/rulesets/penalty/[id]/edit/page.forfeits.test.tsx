import type * as ApiClient from '@myclash/api-client';
import { FFAMHE_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  choose,
  editReads,
  MARKER,
  openPenaltyPage,
  press,
  save,
  typeInto,
  type OpenedPenaltyPage,
} from '../../../../../../../src/components/rulesets/penalty-page.fixtures';
import AdminEditPenaltyRulesetPage from '../../../../../../admin/rulesets/penalty/[id]/edit/page';
import OrgEditPenaltyRulesetPage from './page';

/**
 * The penalty ruleset editor's Forfeits section (operator rulings 63-76, 2026-10-20): what each
 * reason does, "disqualify after N" (Off or 1-10) and "a forfeit before the 1st bout
 * disqualifies"; with a black card forfeit's 0-X beside the card settings. The club's editor and
 * the platform's save what is shown.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', id: 'pr-1' }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const EDITORS = [
  ['the club’s editor', <OrgEditPenaltyRulesetPage key="org" />],
  ['the platform’s editor', <AdminEditPenaltyRulesetPage key="admin" />],
] as const;

let page: OpenedPenaltyPage;
afterEach(() => page.unmount());

const savedRules = () => page.saves[0]?.body['forfeitRules'];

describe.each(EDITORS)('the Forfeits section of %s', (_editor, editor) => {
  it('saves the rules it was opened on, untouched', async () => {
    page = await openPenaltyPage(editor, editReads(MARKER));

    await save();

    expect(savedRules()).toEqual(MARKER);
  });

  it('saves a value set in each of its fields', async () => {
    page = await openPenaltyPage(editor, editReads(FFAMHE_FORFEIT_RULES));

    await choose('forfeit-injury-outcome', 'fixed_loss');
    await typeInto('forfeit-injury-score', '9');
    await choose('forfeit-injury-fighter', 'withdrawn');
    await choose('forfeit-voluntary-fighter', 'disqualified');
    await choose('forfeit-conduct_violation-outcome', 'keep_current');
    await choose('forfeit-disqualify-after', '7');
    await typeInto('forfeit-black-card-score', '13');
    await press('forfeit-before-first-bout');
    await save();

    const { voluntary, conduct_violation } = FFAMHE_FORFEIT_RULES.reasons;
    expect(savedRules()).toEqual({
      ...MARKER,
      reasons: {
        ...MARKER.reasons,
        voluntary: { ...voluntary, fighter: 'disqualified' },
        conduct_violation: { ...conduct_violation, outcome: 'keep_current' },
      },
      disqualifyBeforeFirstBout: true,
    });
  });

  // A score the server refuses is refused on the page, in the field, even on a reason whose
  // bout keeps its score: the score is stored and checked whatever the outcome.
  it('refuses a score out of range before it is sent', async () => {
    page = await openPenaltyPage(editor, editReads(FFAMHE_FORFEIT_RULES));

    await choose('forfeit-injury-outcome', 'fixed_loss');
    await typeInto('forfeit-injury-score', '');
    await choose('forfeit-injury-outcome', 'keep_current');
    await save();

    expect(page.saves).toEqual([]);
  });

  // The Forfeits section draws the two black card settings only in a Tournament's block, where
  // they are its changes; here the editor's own selects write the card columns, one each.
  it('holds one select per black card setting, the card columns’', async () => {
    page = await openPenaltyPage(editor, editReads(FFAMHE_FORFEIT_RULES));

    const cardSelects = [...document.body.querySelectorAll('select')].filter((select) =>
      ['match', 'tournament', 'none'].every((v) => select.querySelector(`option[value="${v}"]`)),
    );
    expect(cardSelects).toHaveLength(2);
    expect(
      document.body.querySelector('[data-testid^="forfeit-"][data-testid$="BlackCard"]'),
    ).toBeNull();
  });

  // A draw is 0-0 on a Pool or Swiss bout, and the loss on a bracket bout (rulings 64, 72): the
  // opponent's score still counts there, so its field stays live.
  it('saves a reason that counts as a draw, its loss score still live', async () => {
    page = await openPenaltyPage(editor, editReads(FFAMHE_FORFEIT_RULES));

    await choose('forfeit-voluntary-outcome', 'draw');
    await typeInto('forfeit-voluntary-score', '8');
    await save();

    const outcome = document.body.querySelector('[data-testid="forfeit-voluntary-outcome"]');
    expect(outcome?.querySelector('option[value="draw"]')?.textContent).toBe(
      'A draw, 0-0 (a loss in a bracket)',
    );
    const { voluntary } = FFAMHE_FORFEIT_RULES.reasons;
    expect(savedRules()).toEqual({
      ...FFAMHE_FORFEIT_RULES,
      reasons: {
        ...FFAMHE_FORFEIT_RULES.reasons,
        voluntary: { ...voluntary, outcome: 'draw', opponentScore: 8 },
      },
    });
  });

  it('saves Off as "off"', async () => {
    page = await openPenaltyPage(editor, editReads(FFAMHE_FORFEIT_RULES));

    await choose('forfeit-disqualify-after', 'off');
    await save();

    expect(savedRules()).toEqual({ ...FFAMHE_FORFEIT_RULES, disqualifyAfter: 'off' });
  });
});
