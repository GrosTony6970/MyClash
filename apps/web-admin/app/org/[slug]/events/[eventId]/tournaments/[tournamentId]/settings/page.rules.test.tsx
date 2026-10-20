import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { normalizeMatchFormatConfig } from '@myclash/rulesets';
import { type } from '../../../archived-page.fixtures';
import { button, EFFECTIVE_RULES } from './page.fixtures';
import { control, labelled, openTab, rowOf, type OpenedTab } from './page.rules.fixtures';

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
    expect(values).toEqual(['3']);

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
});

describe('the Advanced tab', () => {
  const ruleRow = { ruleset_is_system: false };

  it('shows Off where no forfeit rule is stored, and sends a count chosen', async () => {
    opened = await openTab('advanced', { row: ruleRow });
    expect(valueOf('Disqualify after N forfeits')).toBe('off');
    await set('Disqualify after N forfeits', '3');
    await save();
    expect(opened.saved).toEqual([{ rulesetConfig: { tournamentPolicy: { disqualifyAfter: 3 } } }]);
  });

  it('sends Off as a null, which removes the rule (ruling 52)', async () => {
    const tf = {
      ...EFFECTIVE_RULES.tf,
      tournamentPolicy: { ...EFFECTIVE_RULES.tf.tournamentPolicy, disqualifyAfter: 2 },
    };
    opened = await openTab('advanced', { row: ruleRow, effectiveRules: { tf } });
    await set('Disqualify after N forfeits', 'off');
    await save();
    expect(opened.saved).toEqual([
      { rulesetConfig: { tournamentPolicy: { disqualifyAfter: null } } },
    ]);
  });

  it('badges against what the ruleset starts from, and Reset writes it (ruling 51)', async () => {
    const start = { ...EFFECTIVE_RULES.start, tf: { ...EFFECTIVE_RULES.start.tf, winBonus: 5 } };
    opened = await openTab('advanced', { row: ruleRow, effectiveRules: { start } });
    expect(rowOf('Win bonus').textContent).toContain('modified');
    expect(rowOf('Disqualify after N forfeits').textContent).toContain('modified');

    await reset('Win bonus');
    await save();
    expect(opened.saved).toEqual([{ rulesetConfig: { winBonus: 5 } }]);
  });

  it('shows no badge when what the ruleset starts from is unknown', async () => {
    opened = await openTab('advanced', { row: ruleRow, effectiveRules: { start: null } });
    await set('Win bonus', '6');
    expect(rowOf('Win bonus').textContent).not.toContain('modified');
    expect(rowOf('Disqualify after N forfeits').textContent).not.toContain('modified');
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
