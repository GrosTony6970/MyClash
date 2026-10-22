import type * as ApiClient from '@myclash/api-client';
import { act } from 'react';
import { DEFAULT_FORMULA_CONSTANTS } from '@myclash/rulesets';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  labelled,
  openPenaltyPage,
  save,
  typeInto,
  type OpenedPenaltyPage,
} from './penalty-page.fixtures';
import { RulesetForm, type RulesetFormValue } from './RulesetForm';
import { rulesetFormInitial, type RulesetRowLike } from './ruleset-form-initial';
import { VICTORIES } from './scoring-page.fixtures';

/**
 * The ruleset editor shows the engine's values and saves only what the author changed (operator
 * rulings 59, 60, 134, 136-138, 141). The form is built from a stored row through the pages' own
 * hydration, so what is asserted is what an organiser sees.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

type Submitted = Record<string, unknown>;

let page: OpenedPenaltyPage;
let submitted: Submitted[];
afterEach(() => page.unmount());

function row(over: Partial<RulesetRowLike>): RulesetRowLike {
  return {
    code: 'custom_house',
    match_format_defaults: null,
    double_penalty_formula: null,
    ...over,
  };
}

async function openForm(stored: RulesetRowLike, disabled = false): Promise<void> {
  submitted = [];
  const initial = {
    name: 'House pools',
    description: '',
    version: '1.0.0',
    scoreFormula: VICTORIES,
    constants: DEFAULT_FORMULA_CONSTANTS,
    tiebreakers: [],
    ...rulesetFormInitial(stored),
  } as unknown as RulesetFormValue;
  page = await openPenaltyPage(
    <RulesetForm
      initial={initial}
      code={stored.code}
      baseCode={stored.base_code ?? null}
      disabled={disabled}
      submitLabel="Save"
      onSubmit={(data) => submitted.push(data as unknown as Submitted)}
    />,
    {},
  );
}

/** The refusal of a Save while a field holds no value the rules take (en). */
const REFUSAL = 'A field is empty or holds a value the rules refuse';
const field = (words: string) => labelled(words).value;
const text = () => document.body.textContent ?? '';
const resetLinks = () =>
  [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Reset');

async function pressReset(): Promise<void> {
  const [reset] = resetLinks();
  if (!reset) throw new Error('no Reset on the form');
  await act(async () => reset.click());
}

describe('the match format box of an empty ruleset', () => {
  it('shows the engine’s values, with no badge', async () => {
    await openForm(row({}));

    expect(field('Point cap')).toBe('10');
    expect(field('Time limit · pool')).toBe('90');
    expect(field('Soft clock')).toBe('5');
    expect(field('Max double hits')).toBe('4');
    expect(text()).not.toContain('modified');
  });

  it('survives a cleared point cap and saves the 7 typed after it', async () => {
    await openForm(row({}));

    await typeInto(labelled('Point cap'), '');
    await typeInto(labelled('Point cap'), '7');
    await save();

    expect(submitted[0]?.['matchFormatDefaults']).toEqual({ pointCap: 7 });
  });

  it.each(['Point cap', 'Time limit · pool'])('refuses Save while %s is empty', async (words) => {
    await openForm(row({}));

    await typeInto(labelled(words), '');
    await save();

    expect(submitted).toHaveLength(0);
    expect(text()).toContain(REFUSAL);
  });
});

describe('a ruleset’s own match format', () => {
  it('saves only the changed field beside what it stored, the hidden best-of included', async () => {
    await openForm(row({ match_format_defaults: { pointCap: 7, bestOf: { pool: 3 } } }));

    await typeInto(labelled('Time limit · pool'), '150');
    await save();

    expect(submitted[0]?.['matchFormatDefaults']).toEqual({
      pointCap: 7,
      bestOf: { pool: 3 },
      timeLimitsSeconds: { pool: 150 },
    });
  });

  it('saves a 0 typed into a time limit as "no limit"', async () => {
    await openForm(row({}));

    await typeInto(labelled('Time limit · pool'), '0');
    await save();

    expect(submitted[0]?.['matchFormatDefaults']).toEqual({ timeLimitsSeconds: { pool: null } });
  });

  it('shows a stored "no limit" as 0 and keeps it on an untouched Save', async () => {
    await openForm(row({ match_format_defaults: { timeLimitsSeconds: { pool: null } } }));

    expect(field('Time limit · pool')).toBe('0');
    await save();

    expect(submitted[0]?.['matchFormatDefaults']).toEqual({ timeLimitsSeconds: { pool: null } });
  });

  it('badges a value that differs from the engine, and Reset empties it', async () => {
    await openForm(row({ match_format_defaults: { pointCap: 7 } }));
    expect(text()).toContain('modified');

    await pressReset();
    expect(field('Point cap')).toBe('10');
    expect(text()).not.toContain('modified');
    await save();

    expect(submitted[0]?.['matchFormatDefaults']).toBeNull();
  });

  it('shows the engine’s value again after a typed value is reset', async () => {
    await openForm(row({}));

    await typeInto(labelled('Point cap'), '8');
    await pressReset();

    expect(field('Point cap')).toBe('10');
  });

  it('follows the engine again when its value is typed back', async () => {
    await openForm(row({ match_format_defaults: { pointCap: 7 } }));

    await typeInto(labelled('Point cap'), '10');
    expect(text()).not.toContain('modified');
    await save();

    expect(submitted[0]?.['matchFormatDefaults']).toBeNull();
  });

  it('offers no Reset while the form is disabled', async () => {
    await openForm(row({ match_format_defaults: { pointCap: 7 } }), true);

    expect(resetLinks()).toHaveLength(0);
  });
});

describe('a TF_v1 ruleset’s dials', () => {
  const tf = (tfConfig: Record<string, unknown>) =>
    row({ code: 'custom_tf_v1_fork_abc', base_code: 'TF_v1', tf_config: tfConfig });

  it('badges its own win bonus, and Reset makes it follow the engine', async () => {
    await openForm(tf({ winBonus: 5 }));
    expect(field('Win bonus')).toBe('5');
    expect(text()).toContain('modified');

    await pressReset();
    expect(field('Win bonus')).toBe('3');
    await save();

    expect(submitted[0]?.['ownCoded']).toEqual({});
  });

  it('refuses Save while the win bonus is empty', async () => {
    await openForm(tf({}));

    await typeInto(labelled('Win bonus'), '');
    await save();

    expect(submitted).toHaveLength(0);
    expect(text()).toContain(REFUSAL);
  });

  it('saves "no penalty" as the engine’s 0 formula and shows that preset', async () => {
    await openForm(tf({}));
    const select = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === '__none__'),
    );
    if (!select) throw new Error('no double-penalty select');

    await act(async () => {
      select.value = '__none__';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select.value).toBe('0');
    await save();

    expect(submitted[0]?.['ownCoded']).toEqual({ doublePenaltyFormula: '0' });
  });
});

/** What each editor shows and lets the author change (`EDITOR_SECTIONS`, ruling 139). */
const KINDS: Array<[string, Partial<RulesetRowLike>, Record<string, boolean>]> = [
  [
    'a TF_v1 copy',
    { code: 'custom_tf_v1_fork_abc', base_code: 'TF_v1' },
    { formula: false, dials: true, targets: true, afterblow: false, maxDoubles: true },
  ],
  [
    'Points cap',
    { code: 'Generic_PointsCap' },
    { formula: false, dials: false, targets: false, afterblow: false, maxDoubles: false },
  ],
  [
    'a formula ruleset',
    { code: 'custom_house' },
    { formula: true, dials: false, targets: true, afterblow: true, maxDoubles: true },
  ],
];

describe.each(KINDS)('the editor of %s', (_name, stored, expected) => {
  it('shows and unlocks exactly its own sections', async () => {
    await openForm(row(stored));
    const has = (words: string) =>
      [...document.querySelectorAll('label, h3')].some((each) =>
        each.textContent?.trim().startsWith(words),
      );
    const target = document.querySelector<HTMLInputElement>('input[aria-label="Target name"]');

    expect({
      formula: has('Score formula'),
      dials: has('Win bonus'),
      targets: target?.disabled === false,
      afterblow: !labelled('This ruleset uses afterblow').disabled,
      maxDoubles: has('Max double hits'),
    }).toEqual(expected);
  });
});
