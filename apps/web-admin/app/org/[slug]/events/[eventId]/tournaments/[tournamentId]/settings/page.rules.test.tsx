import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { normalizeMatchFormatConfig, parseMatchFormatConfig } from '@myclash/rulesets';
import { type } from '../../../archived-page.fixtures';
import { button, EFFECTIVE_RULES } from './page.fixtures';
import {
  control,
  labelled,
  openTab,
  rowOf,
  TOURNAMENT,
  type OpenedTab,
} from './page.rules.fixtures';

/**
 * The Match format, Display and Advanced tabs show the rules in force the API answers
 * (`effectiveRules`), hold no default of their own, and a Save sends only what the organiser
 * changed (operator rulings 43, 46, 48, 51, 52). Each tab's first case shows a value the rules in
 * force hold and the raw columns (empty) do not, so a tab that read the raw row shows something
 * else. The read states of every tab: `page.rules-states.test.tsx`.
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

let opened: OpenedTab;
afterEach(() => opened.page.unmount());

const valueOf = (text: string) => control(text).value;
async function set(text: string, value: string) {
  await act(async () => type(control(text), value));
}
async function save() {
  await act(async () => button('Save changes').click());
  await opened.page.settle();
}
async function reset(text: string) {
  const link = [...rowOf(text).querySelectorAll('button')].find((b) => b.textContent === 'Reset');
  expect(link, `no Reset by "${text}"`).toBeDefined();
  await act(async () => link!.click());
}
const noChanges = () => document.body.textContent?.includes('No changes to save');

describe('the Match format tab', () => {
  /** The engine's values with a cap of 7, over a row that stores nothing. */
  const CAP_7 = {
    matchFormat: normalizeMatchFormatConfig({ pointCap: 7 }),
    start: { ...EFFECTIVE_RULES.start, matchFormat: normalizeMatchFormatConfig({ pointCap: 7 }) },
  };

  it('shows the format in force, and an untouched Save sends nothing', async () => {
    opened = await openTab('match-format', { effectiveRules: CAP_7 });
    expect(valueOf('Point cap')).toBe('7');
    expect(valueOf('Pool match time')).toBe('90');
    expect(valueOf('Soft clock')).toBe('5');

    await save();
    expect(opened.saved).toEqual([]);
    expect(noChanges()).toBe(true);
  });

  it('sends exactly the field changed, and a change undone after a save', async () => {
    opened = await openTab('match-format', { effectiveRules: CAP_7 });
    await set('Pool match time', '120');
    await save();
    await set('Pool match time', '90');
    await save();
    expect(opened.saved).toEqual([
      { rulesetConfig: { matchFormat: { timeLimitsSeconds: { pool: 120 } } } },
      { rulesetConfig: { matchFormat: { timeLimitsSeconds: { pool: 90 } } } },
    ]);
  });

  it('badges against what the ruleset starts from at its version, and Reset writes it (ruling 51)', async () => {
    const start = {
      ...EFFECTIVE_RULES.start,
      matchFormat: normalizeMatchFormatConfig({
        timeLimitsSeconds: { pool: 120, bracket: 90, finals: 90 },
      }),
    };
    opened = await openTab('match-format', { effectiveRules: { start } });
    expect(rowOf('Pool match time').textContent).toContain('modified');
    expect(rowOf('Point cap').textContent).not.toContain('modified');

    await reset('Pool match time');
    expect(valueOf('Pool match time')).toBe('120');
    await save();
    expect(opened.saved).toEqual([
      { rulesetConfig: { matchFormat: { timeLimitsSeconds: { pool: 120 } } } },
    ]);
  });

  it('resets a ceiling the ruleset starts without to none, never the 0 the engine refuses', async () => {
    const start = {
      ...EFFECTIVE_RULES.start,
      matchFormat: { ...normalizeMatchFormatConfig({}), maxDoubleHits: null },
    };
    opened = await openTab('match-format', { effectiveRules: { start } });
    await reset('Max double hits');
    await save();
    expect(opened.saved).toEqual([{ rulesetConfig: { matchFormat: { maxDoubleHits: null } } }]);
  });

  it('shows a best-of beyond 7 as itself, in force and as the start (ruling 51)', async () => {
    const start = {
      ...EFFECTIVE_RULES.start,
      matchFormat: normalizeMatchFormatConfig({ bestOf: { pool: 3, bracket: 11 } }),
    };
    const matchFormat = normalizeMatchFormatConfig({ bestOf: { pool: 9, bracket: 1 } });
    opened = await openTab('match-format', { effectiveRules: { matchFormat, start } });
    const shown = (text: string) =>
      (control(text) as unknown as HTMLSelectElement).selectedOptions[0]?.textContent;

    // Pool's 9 is in force only, Bracket's 11 the start only: each held value is shown.
    expect(shown('Pool best-of')).toBe('Best of 9');
    expect(rowOf('Pool best-of').textContent).toContain('modified');
    // Picked away and back: the 9 read stays a choice.
    await set('Pool best-of', '1');
    await set('Pool best-of', '9');
    expect(shown('Pool best-of')).toBe('Best of 9');
    await reset('Bracket best-of');
    expect(shown('Bracket best-of')).toBe('Best of 11');
    await save();
    expect(opened.saved).toEqual([{ rulesetConfig: { matchFormat: { bestOf: { bracket: 11 } } } }]);
  });

  it('scores by venues: shows the venue fields, hides the cap and the direction, and saves the unit', async () => {
    opened = await openTab('match-format', { effectiveRules: CAP_7 });
    const has = (text: string) =>
      [...document.querySelectorAll('label')].some((l) => l.textContent?.startsWith(text));
    expect(has('Pool won venues per round')).toBe(false);

    await set('Score by', 'venues');
    expect(has('Pool won venues per round')).toBe(true);
    expect(has('Bracket won venues per round')).toBe(true);
    expect(has('Finals won venues per round')).toBe(true);
    expect(has('Stop the round as soon as it is decided')).toBe(true);
    expect(has('Point cap')).toBe(false);
    expect(has('Scoring direction')).toBe(false);

    await set('Pool won venues per round', '7');
    await save();
    expect(opened.saved).toEqual([
      { rulesetConfig: { matchFormat: { scoringUnit: 'venues', venuesPerRound: { pool: 7 } } } },
    ]);
  });

  it('back in points, shows the countdown a venues Tournament stores, and sends a pick of count up', async () => {
    // As the API answers it: the direction stored, not the count-up a venues bout plays.
    const matchFormat = parseMatchFormatConfig({
      scoringUnit: 'venues',
      scoringDirection: 'reverse_zero_loses',
    });
    opened = await openTab('match-format', { effectiveRules: { matchFormat } });
    await set('Score by', 'points');
    expect(valueOf('Scoring direction')).toBe('reverse_zero_loses');

    await set('Scoring direction', 'normal');
    await save();
    expect(opened.saved).toEqual([
      { rulesetConfig: { matchFormat: { scoringUnit: 'points', scoringDirection: 'normal' } } },
    ]);
  });

  it('offers no unit choice on a ruleset without venues', async () => {
    opened = await openTab('match-format', {
      effectiveRules: CAP_7,
      row: { ruleset_grammar: { hasAfterblow: false, hasMaxDoubles: false, hasVenues: false } },
    });
    expect(
      [...document.querySelectorAll('label')].some((l) => l.textContent?.startsWith('Score by')),
    ).toBe(false);
    expect(valueOf('Point cap')).toBe('7');
  });

  it('shows no badge and no Reset when what the ruleset starts from is unknown', async () => {
    opened = await openTab('match-format', { effectiveRules: { ...CAP_7, start: null } });
    await set('Point cap', '9');
    expect(valueOf('Point cap')).toBe('9');
    expect(rowOf('Point cap').textContent).not.toContain('modified');
  });
});

describe('the Display tab', () => {
  /** The scoring in force: green for fighter 1 and a +3, which the empty raw column holds not. */
  const SCORING = {
    ...EFFECTIVE_RULES.scoring,
    buttons: { clean: [{ label: '+3', value: 3, visible: true }], afterblow: [] },
    display: { sideColors: { red: 'green' as const, blue: 'blue' as const }, quickPenalties: [] },
  };

  it('shows the buttons and colours in force, and an untouched Save sends nothing', async () => {
    opened = await openTab('display', { effectiveRules: { scoring: SCORING } });
    expect(valueOf('Fighter 1')).toBe('green');
    const values = [
      ...document.body.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    ].map((i) => i.value);
    // The +3, then the protest limit: none stored, so none in force.
    expect(values).toEqual(['3', '']);

    await save();
    expect(opened.saved).toEqual([]);
    expect(noChanges()).toBe(true);
  });

  it('sends only the side colour changed', async () => {
    opened = await openTab('display');
    await set('Fighter 1', 'green');
    await save();
    expect(opened.saved).toEqual([
      { scoringConfig: { display: { sideColors: { red: 'green' } } } },
    ]);
  });

  it('sets a protest limit and the penalty it offers, and says when none is offered', async () => {
    const NO_OFFER = 'The pad will count and warn, and offer no penalty.';
    opened = await openTab('display');
    expect(valueOf('Protest limit')).toBe('');
    expect(valueOf('Penalty offered past the limit')).toBe('');
    expect(document.body.textContent).not.toContain(NO_OFFER);

    await set('Protest limit', '2');
    expect(document.body.textContent).toContain(NO_OFFER);
    // The penalty list's own entries, valued by their ref.
    await set('Penalty offered past the limit', '1');
    expect(document.body.textContent).not.toContain(NO_OFFER);

    await save();
    expect(opened.saved).toEqual([
      { scoringConfig: { display: { protests: { limit: 2, offerPenaltyRef: '1' } } } },
    ]);
  });

  it('pins a quick-pick penalty by its ref as text, and saves it', async () => {
    const penaltyList = {
      penalty_ruleset_entries: [
        { id: 'pe-1', ref_number: '2', short_name: 'Late', group_number: 1, sanctions: [] },
        { id: 'pe-2', ref_number: 'R7a', short_name: 'Halt', group_number: 1, sanctions: [] },
        { id: 'pe-3', ref_number: '10', short_name: 'Brutal', group_number: 1, sanctions: [] },
      ],
    };
    opened = await openTab('display', {
      reads: { [`${TOURNAMENT}/penalty-ruleset`]: penaltyList },
    });
    // Sorted as a person reads them: 2 before 10, the letter ref after the numbers.
    const pinned = [...document.body.querySelectorAll('fieldset')].find((f) =>
      f.querySelector('legend')?.textContent?.includes('Quick-pick penalties'),
    );
    const boxes = [...pinned!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => b.closest('label')?.textContent)).toEqual([
      '2Late',
      '10Brutal',
      'R7aHalt',
    ]);

    await act(async () => boxes[2]!.click());
    await save();
    expect(opened.saved).toEqual([{ scoringConfig: { display: { quickPenalties: ['R7a'] } } }]);
  });

  const INVALID_LIMIT = 'A whole number, 0 or more.';

  it.each(['2.5', '-1'])('a protest limit of %s blocks the Save and says why', async (limit) => {
    opened = await openTab('display');
    await set('Protest limit', limit);
    expect(document.body.textContent).toContain(INVALID_LIMIT);

    await save();
    expect(opened.saved).toEqual([]);
  });

  it.each([
    ['', null],
    ['3', 3],
  ])('a protest limit of "%s" saves', async (typed, limit) => {
    // Stored 2, so an empty limit is a change too.
    const scoring = {
      ...EFFECTIVE_RULES.scoring,
      display: { ...EFFECTIVE_RULES.scoring.display, protests: { limit: 2, offerPenaltyRef: '1' } },
    };
    opened = await openTab('display', { effectiveRules: { scoring } });
    await set('Protest limit', typed);
    expect(document.body.textContent).not.toContain(INVALID_LIMIT);

    await save();
    expect(opened.saved).toEqual([{ scoringConfig: { display: { protests: { limit } } } }]);
  });

  it('shows a stored penalty the list no longer holds, says the pad offers nothing, and clears it', async () => {
    const scoring = {
      ...EFFECTIVE_RULES.scoring,
      display: { ...EFFECTIVE_RULES.scoring.display, protests: { limit: 2, offerPenaltyRef: '8' } },
    };
    opened = await openTab('display', { effectiveRules: { scoring } });
    const select = control('Penalty offered past the limit') as HTMLSelectElement;
    expect(select.value).toBe('8');
    expect(select.selectedOptions[0]?.textContent).toBe('8 (not in the penalty list)');
    expect(document.body.textContent).toContain(
      'The pad will count and warn, and offer no penalty.',
    );

    // "None" is a real change now.
    await set('Penalty offered past the limit', '');
    await save();
    expect(opened.saved).toEqual([
      { scoringConfig: { display: { protests: { offerPenaltyRef: null } } } },
    ]);
  });
});

describe('the Advanced tab', () => {
  const ruleRow = { ruleset_is_system: false };

  it('shows no forfeit rule: the penalty ruleset owns them (rulings 63, 68)', async () => {
    opened = await openTab('advanced', { row: ruleRow });
    expect(document.body.textContent).toContain('Win bonus');
    expect(document.body.textContent).not.toContain('Disqualify after');
    expect(document.body.textContent).not.toContain('Forfeit counts as draw');
  });

  it('badges against what the ruleset starts from, and Reset writes it (ruling 51)', async () => {
    const start = { ...EFFECTIVE_RULES.start, tf: { ...EFFECTIVE_RULES.start.tf, winBonus: 5 } };
    opened = await openTab('advanced', { row: ruleRow, effectiveRules: { start } });
    expect(rowOf('Win bonus').textContent).toContain('modified');

    await reset('Win bonus');
    await save();
    expect(opened.saved).toEqual([{ rulesetConfig: { winBonus: 5 } }]);
  });

  it('shows no badge when what the ruleset starts from is unknown', async () => {
    opened = await openTab('advanced', { row: ruleRow, effectiveRules: { start: null } });
    await set('Win bonus', '6');
    expect(rowOf('Win bonus').textContent).not.toContain('modified');
  });

  it('a field name is a label of its control, never of its Reset', async () => {
    const start = { ...EFFECTIVE_RULES.start, tf: { ...EFFECTIVE_RULES.start.tf, winBonus: 5 } };
    opened = await openTab('advanced', { row: ruleRow, effectiveRules: { start } });
    expect(document.getElementById(labelled('Win bonus').htmlFor)?.tagName).toBe('INPUT');
  });

  it('shows no TF_v1 controls for a ruleset whose engine is not TF_v1, and sends nothing', async () => {
    opened = await openTab('advanced', { effectiveRules: { tf: null } });
    expect(document.body.textContent).not.toContain('Win bonus');
    await save();
    expect(opened.saved).toEqual([]);
    expect(noChanges()).toBe(true);
  });
});
