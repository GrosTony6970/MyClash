import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG, RULES_CHANGE_PATHS, type FormatPhase } from '@myclash/types';
import { canonicalizeScoringBehaviour, stableStringify } from './content-hash';
import { buttonValuesOf, clockLocks, lockedChanges, scoringDiff } from './scoring-diff';

/**
 * The diff the rules lock reads. Its promise is that it cannot miss a change the content hash
 * sees: every leaf of the canonical belongs to exactly one listed path, each listed path changed
 * alone is one entry, and a leaf nobody listed is still one `unknown` entry.
 */

// A FULL match format: every per-phase key carries a Swiss value, so the Swiss paths are leaves.
const matchFormat = {
  pointCap: 7,
  scoringDirection: 'normal',
  timerMode: 'countdown',
  timeLimitsSeconds: { pool: 90, swiss: 100, bracket: 120, finals: 180 },
  softClockLimitSeconds: 5,
  maxDoubleHits: 4,
  maxDoubleHitOutcome: 'double_loss_zero_scores',
  bestOf: { pool: 1, swiss: 1, bracket: 3, finals: 3 },
  levelAtTime: {
    pool: [{ kind: 'draw' }],
    swiss: [{ kind: 'draw' }],
    bracket: [{ kind: 'sudden_death' }],
    finals: [{ kind: 'extra_time', seconds: 60 }, { kind: 'sudden_death' }],
  },
};
const grammar = {
  targets: [
    { name: 'head', value: 3 },
    { name: 'body', value: 2 },
  ],
  hasAfterblow: true,
  afterblowValuation: 'fixed' as const,
  afterblowFixedValue: 1,
};
const shared = {
  grammar,
  matchFormat,
  afterblowMode: 'deductive',
  doublePenaltyFormula: 'n_times_n_minus_1_over_3',
};
const coded = canonicalizeScoringBehaviour({
  kind: 'coded',
  engineCode: 'TF_v1',
  engineVersion: '1.1.0',
  ...shared,
  winBonus: 3,
});
const formula = canonicalizeScoringBehaviour({
  kind: 'formula',
  ...shared,
  scoreFormula: { type: 'var', name: 'victories' },
  constants: { pointsPerVictory: 3 },
  tiebreakers: [{ variable: 'victories', direction: 'desc' }],
  decisionEdition: '2026-10',
});

const CANONICAL_PATHS = RULES_CHANGE_PATHS.filter((path) => !path.startsWith('buttons.'));

/** The test's own leaf walk: anything but a non-empty plain object is a leaf. */
function leavesOf(value: unknown, prefix: string[] = []): string[] {
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  if (isObject && Object.keys(value).length > 0) {
    return Object.entries(value).flatMap(([key, child]) => leavesOf(child, [...prefix, key]));
  }
  return [prefix.join('.')];
}

const covers = (path: string, leaf: string) => leaf === path || leaf.startsWith(`${path}.`);

/** No stored buttons: the default buttons, as the pad scores them. */
const NO_BUTTONS = buttonValuesOf(null);

function withValue(canonical: Record<string, unknown>, path: string, value: unknown) {
  const copy = structuredClone(canonical);
  const segments = path.split('.');
  let node = copy as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) node = node[segment] as Record<string, unknown>;
  node[segments[segments.length - 1]!] = value;
  return copy;
}

const has = (canonical: Record<string, unknown>, path: string) =>
  leavesOf(canonical).some((leaf) => covers(path, leaf));

describe('scoringDiff — leaf coverage', () => {
  it.each([
    ['coded', coded],
    ['formula', formula],
  ])('covers every leaf of a %s canonical by exactly one listed path', (_kind, canonical) => {
    for (const leaf of leavesOf(canonical)) {
      const owners = CANONICAL_PATHS.filter((path) => covers(path, leaf));
      expect({ leaf, owners: owners.length }).toEqual({ leaf, owners: 1 });
    }
  });

  it('lists no path that neither kind of canonical has', () => {
    for (const path of CANONICAL_PATHS) {
      expect({ path, found: has(coded, path) || has(formula, path) }).toEqual({
        path,
        found: true,
      });
    }
  });

  it('names each listed path changed alone by exactly one entry', () => {
    for (const path of CANONICAL_PATHS) {
      const canonical = has(coded, path) ? coded : formula;
      const after = withValue(canonical, path, { changedAlone: path });
      const changes = scoringDiff(
        { canonical, buttons: NO_BUTTONS },
        { canonical: after, buttons: NO_BUTTONS },
      );
      expect(changes.map((change) => change.path)).toEqual([path]);
    }
  });

  it('gives no entry for two equal canonicals', () => {
    expect(
      scoringDiff(
        { canonical: coded, buttons: NO_BUTTONS },
        { canonical: structuredClone(coded), buttons: NO_BUTTONS },
      ),
    ).toEqual([]);
  });

  it('carries a list as ONE entry with the whole list before and after', () => {
    const targets = [{ name: 'head', value: 4 }];
    const changes = scoringDiff(
      { canonical: formula, buttons: NO_BUTTONS },
      { canonical: withValue(formula, 'grammar.targets', targets), buttons: NO_BUTTONS },
    );
    expect(changes).toEqual([
      {
        path: 'grammar.targets',
        before: (formula['grammar'] as typeof grammar).targets,
        after: targets,
      },
    ]);
  });

  it('tells an absent Swiss value (reads the pool) from a null one (no limit)', () => {
    const absent = structuredClone(coded);
    delete (absent['matchFormat'] as { timeLimitsSeconds: Record<string, unknown> })
      .timeLimitsSeconds['swiss'];
    const changes = scoringDiff(
      { canonical: absent, buttons: NO_BUTTONS },
      {
        canonical: withValue(absent, 'matchFormat.timeLimitsSeconds.swiss', null),
        buttons: NO_BUTTONS,
      },
    );
    expect(changes).toEqual([
      { path: 'matchFormat.timeLimitsSeconds.swiss', before: undefined, after: null },
    ]);
  });

  it('reads a key present with no value as the hash does: null, not absent', () => {
    const absent = structuredClone(coded);
    delete (absent['matchFormat'] as { timeLimitsSeconds: Record<string, unknown> })
      .timeLimitsSeconds['swiss'];
    const unset = withValue(absent, 'matchFormat.timeLimitsSeconds.swiss', undefined);
    // `stableStringify` writes the unset key as null, so the hash moves: the diff must say so.
    expect(stableStringify(unset)).not.toBe(stableStringify(absent));
    expect(
      scoringDiff(
        { canonical: absent, buttons: NO_BUTTONS },
        { canonical: unset, buttons: NO_BUTTONS },
      ),
    ).toEqual([{ path: 'matchFormat.timeLimitsSeconds.swiss', before: undefined, after: null }]);
  });

  it('fails closed: a leaf no listed path covers is ONE unknown entry', () => {
    const after = withValue(withValue(coded, 'matchFormat.newKnob', 3), 'newField', {});
    expect(
      scoringDiff(
        { canonical: coded, buttons: NO_BUTTONS },
        { canonical: after, buttons: NO_BUTTONS },
      ),
    ).toEqual([
      {
        path: 'unknown',
        before: { 'matchFormat.newKnob': undefined, newField: undefined },
        after: { 'matchFormat.newKnob': 3, newField: {} },
      },
    ]);
  });

  it('lists entries in the path list order, the unknown one last', () => {
    const after = withValue(
      withValue(withValue(coded, 'zzz', 1), 'winBonus', 5),
      'matchFormat.pointCap',
      9,
    );
    const paths = scoringDiff(
      { canonical: coded, buttons: NO_BUTTONS },
      { canonical: after, buttons: NO_BUTTONS },
    ).map((c) => c.path);
    expect(paths).toEqual(['matchFormat.pointCap', 'winBonus', 'unknown']);
  });
});

describe('buttonValuesOf and the button entries', () => {
  const stored = {
    buttons: {
      clean: [
        { label: '+1', value: 1, visible: true },
        { label: '+3', value: 3, visible: false },
      ],
      afterblow: [
        { label: '3-1', attackerPts: 3, defenderPts: 1, visible: true },
        { label: '1-1', attackerPts: 1, defenderPts: 1, visible: true },
      ],
    },
  };
  const diffOf = (after: Record<string, unknown>) =>
    scoringDiff(
      { canonical: coded, buttons: buttonValuesOf(stored) },
      { canonical: coded, buttons: buttonValuesOf(after) },
    );

  it('keeps hidden buttons and sorts both lists', () => {
    expect(buttonValuesOf(stored)).toEqual({
      clean: [1, 3],
      afterblow: [
        [1, 1],
        [3, 1],
      ],
    });
  });

  it('reads missing buttons as the default buttons', () => {
    expect(buttonValuesOf(null)).toEqual(
      buttonValuesOf({ buttons: DEFAULT_SCORING_CONFIG.buttons }),
    );
    expect(buttonValuesOf({ buttons: { clean: [] } }).afterblow).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('gives no entry for a reorder, a relabel or a visibility toggle', () => {
    const shuffled = {
      buttons: {
        clean: [
          { label: 'three', value: 3, visible: true },
          { label: 'one', value: 1, visible: false },
        ],
        afterblow: [...stored.buttons.afterblow].reverse(),
      },
    };
    expect(diffOf(shuffled)).toEqual([]);
  });

  it('gives one entry for a value change and one for a new button', () => {
    const clean = [stored.buttons.clean[0]!, { label: '+4', value: 4, visible: false }];
    expect(diffOf({ buttons: { ...stored.buttons, clean } })).toEqual([
      { path: 'buttons.clean', before: [1, 3], after: [1, 4] },
    ]);
    const extra = { label: '4-0', attackerPts: 4, defenderPts: 0, visible: true };
    const afterblow = [...stored.buttons.afterblow, extra];
    expect(diffOf({ buttons: { ...stored.buttons, afterblow } }).map((c) => c.path)).toEqual([
      'buttons.afterblow',
    ]);
  });

  it('reads stored buttons and no stored buttons alike when they score alike', () => {
    expect(
      scoringDiff(
        { canonical: coded, buttons: buttonValuesOf({ buttons: DEFAULT_SCORING_CONFIG.buttons }) },
        { canonical: coded, buttons: NO_BUTTONS },
      ),
    ).toEqual([]);
  });

  it('reads a malformed point as null rather than throwing', () => {
    expect(
      buttonValuesOf({ buttons: { clean: [null, { value: 'x' }, { value: 2 }] } }).clean,
    ).toEqual([2, null, null]);
  });
});

describe('lockedChanges', () => {
  const clock = (running: boolean, started: FormatPhase[]) => ({
    running,
    startedFormatPhases: new Set(started),
  });
  const entry = (path: (typeof RULES_CHANGE_PATHS)[number]) => ({ path, before: 1, after: 2 });
  const lockOf = (path: (typeof RULES_CHANGE_PATHS)[number], c: ReturnType<typeof clock>) =>
    lockedChanges([entry(path)], c)[0]!.locked;

  it('leaves a finals key free while only Pool bouts have started', () => {
    expect(lockOf('matchFormat.timeLimitsSeconds.finals', clock(true, ['pool']))).toBe(false);
  });

  it('locks a finals key once a finals bout has started', () => {
    expect(lockOf('matchFormat.bestOf.finals', clock(true, ['pool', 'finals']))).toBe(true);
  });

  it('locks a pool key on the Tournament clock, as a Tournament key', () => {
    expect(lockOf('matchFormat.levelAtTime.pool', clock(true, []))).toBe(true);
    expect(lockOf('matchFormat.levelAtTime.pool', clock(false, ['pool']))).toBe(true);
    expect(lockOf('matchFormat.levelAtTime.pool', clock(false, []))).toBe(false);
  });

  it('locks the cap once the Tournament runs or any bout of it has started', () => {
    expect(lockOf('matchFormat.pointCap', clock(false, []))).toBe(false);
    expect(lockOf('matchFormat.pointCap', clock(false, ['bracket']))).toBe(true);
    expect(lockOf('matchFormat.pointCap', clock(true, []))).toBe(true);
  });

  it('locks an unknown entry and the buttons on the Tournament clock', () => {
    const changes = [{ path: 'unknown' as const, before: {}, after: {} }, entry('buttons.clean')];
    expect(lockedChanges(changes, clock(true, [])).map((c) => c.locked)).toEqual([true, true]);
  });

  it('clockLocks: locked once the Tournament runs or any bout has started, never before', () => {
    expect(clockLocks(clock(false, []))).toBe(false);
    expect(clockLocks(clock(true, []))).toBe(true);
    expect(clockLocks(clock(false, ['finals']))).toBe(true);
  });

  it('keeps every entry and its values, flagging each', () => {
    const changes = [entry('matchFormat.pointCap'), entry('matchFormat.bestOf.swiss')];
    expect(lockedChanges(changes, clock(true, []))).toEqual([
      { ...changes[0], locked: true },
      { ...changes[1], locked: false },
    ]);
  });
});
