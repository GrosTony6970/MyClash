import { beforeAll, describe, expect, it } from 'vitest';
import {
  RULES_CHANGE_PATHS,
  formatPhaseOfPath,
  rulesChangeKey,
  rulesChangeLines,
  sameTournamentName,
  type RulesChange,
  type RulesChangePath,
} from './rules-change';

type Tree = { readonly [key: string]: string | Tree };

/**
 * The two `common` namespaces, read from the i18n package's source. @myclash/i18n is not a
 * dependency of this package (it would be its only one besides rules), and the i18n sweep checks
 * only `t('…')` calls, not a key held in a map: this is the check that each key resolves. The path
 * is built at run time so tsc does not pull the other package's files into this one's program; it
 * starts from this file's folder because Vite resolves a computed import from the project root.
 */
// Vitest gives every module its folder; this package compiles without Node's types.
declare const __dirname: string;

async function commonOf(locale: 'en' | 'fr'): Promise<Tree> {
  const source = `${__dirname}/../../i18n/src/messages/${locale}/common.ts`;
  return ((await import(source)) as { common: Tree }).common;
}

function resolve(tree: Tree, key: string): unknown {
  const [namespace, ...rest] = key.split('.');
  expect(namespace).toBe('common');
  let cursor: unknown = tree;
  for (const segment of rest) cursor = (cursor as Record<string, unknown> | undefined)?.[segment];
  return cursor;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A translator over one locale's `common`, interpolating `{name}` as the real one does. */
function translator(tree: Tree): Translate {
  return (key, params = {}) => {
    const template = resolve(tree, key);
    if (typeof template !== 'string') throw new Error(`no words for ${key}`);
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));
  };
}

let en: Translate;
let fr: Translate;
beforeAll(async () => {
  en = translator(await commonOf('en'));
  fr = translator(await commonOf('fr'));
});

const change = (path: RulesChangePath, before: unknown, after: unknown): RulesChange => ({
  path,
  before,
  after,
});

describe('rulesChangeKey', () => {
  const paths: RulesChangePath[] = [...RULES_CHANGE_PATHS, 'unknown'];

  it('has a key for every path of the list and for unknown', () => {
    expect(Object.keys(rulesChangeKey).sort()).toEqual([...paths].sort());
  });

  it.each(['en', 'fr'] as const)('words every path in %s', async (locale) => {
    const tree = await commonOf(locale);
    const unworded = paths.filter(
      (path) => typeof resolve(tree, rulesChangeKey[path]) !== 'string',
    );
    expect(unworded).toEqual([]);
  });
});

describe('formatPhaseOfPath', () => {
  it.each([
    ['matchFormat.timeLimitsSeconds.pool', 'pool'],
    ['matchFormat.timeLimitsSeconds.swiss', 'swiss'],
    ['matchFormat.timeLimitsSeconds.bracket', 'bracket'],
    ['matchFormat.timeLimitsSeconds.finals', 'finals'],
    ['matchFormat.bestOf.pool', 'pool'],
    ['matchFormat.bestOf.swiss', 'swiss'],
    ['matchFormat.bestOf.bracket', 'bracket'],
    ['matchFormat.bestOf.finals', 'finals'],
    ['matchFormat.levelAtTime.pool', 'pool'],
    ['matchFormat.levelAtTime.swiss', 'swiss'],
    ['matchFormat.levelAtTime.bracket', 'bracket'],
    ['matchFormat.levelAtTime.finals', 'finals'],
  ] as const)('reads %s as the %s phase', (path, phase) => {
    expect(formatPhaseOfPath(path)).toBe(phase);
  });

  it('gives every other path no phase', () => {
    const phased = RULES_CHANGE_PATHS.filter((path) => formatPhaseOfPath(path) !== null);
    expect(phased).toHaveLength(12);
    expect(formatPhaseOfPath('matchFormat.pointCap')).toBeNull();
    expect(formatPhaseOfPath('matchFormat.softClockLimitSeconds')).toBeNull();
    expect(formatPhaseOfPath('unknown')).toBeNull();
  });
});

describe('rulesChangeLines', () => {
  it('words a number as before and after', () => {
    const changes = [change('matchFormat.pointCap', 5, 7)];
    expect(rulesChangeLines(changes, en)).toEqual(['Point cap: 5 → 7']);
    expect(rulesChangeLines(changes, fr)).toEqual(['Plafond de points : 5 → 7']);
  });

  it('words seconds with their unit, and a null limit as no limit', () => {
    const changes = [change('matchFormat.timeLimitsSeconds.finals', 90, null)];
    expect(rulesChangeLines(changes, en)).toEqual(['Bout time (finals): 90 s → No limit']);
    expect(rulesChangeLines(changes, fr)).toEqual([
      "Durée d'un assaut (finales) : 90 s → Sans limite",
    ]);
  });

  it('words a null afterblow mode and a null win bonus as the default, another null as none', () => {
    expect(rulesChangeLines([change('winBonus', null, 1)], en)).toEqual(['Win bonus: Default → 1']);
    expect(rulesChangeLines([change('grammar.afterblowFixedValue', null, 1)], en)).toEqual([
      'Fixed afterblow points: None → 1',
    ]);
    expect(rulesChangeLines([change('afterblowMode', null, 'deductive')], en)).toEqual([
      'Afterblow mode: Default → Deductive',
    ]);
  });

  it('words an absent Swiss setting as the pools one', () => {
    const changes = [change('matchFormat.timeLimitsSeconds.swiss', undefined, 60)];
    expect(rulesChangeLines(changes, en)).toEqual([
      'Bout time (Swiss rounds): Same as pools → 60 s',
    ]);
  });

  it('words an enum value and a boolean through their keys', () => {
    const changes = [
      change('matchFormat.maxDoubleHitOutcome', 'double_loss_zero_scores', 'result_stands'),
      change('grammar.hasAfterblow', false, true),
    ];
    expect(rulesChangeLines(changes, fr)).toEqual([
      "Résultat au plafond de doubles : Défaite pour les deux, 0–0 → L'assaut s'arrête, le score reste",
      'Contre-frappe : Non → Oui',
    ]);
  });

  it('never shows a raw code: a value it cannot word reads as changed', () => {
    const changes = [
      change('matchFormat.timerMode', 'countdown', 'hourglass'),
      change('matchFormat.pointCap', 5, '7'),
      change('winBonus', undefined, 1),
    ];
    expect(rulesChangeLines(changes, en)).toEqual([
      'Timer mode changed',
      'Point cap changed',
      'Win bonus changed',
    ]);
  });

  it('words a list path as changed, never its value', () => {
    const targets = [{ name: 'head', value: 3 }];
    const changes = [change('grammar.targets', targets, [])];
    expect(rulesChangeLines(changes, en)).toEqual(['Targets changed']);
    expect(rulesChangeLines(changes, fr)).toEqual(['Modification : Cibles']);
  });

  it('words a club\'s own formula as one line on the public notice (ruling "Private formula")', () => {
    const changes = [
      change('scoreFormula', { a: 1 }, { a: 2 }),
      change('constants', { k: 1 }, { k: 2 }),
      change('tiebreakers', [], []),
      change('doublePenaltyFormula', null, { b: 1 }),
      change('winBonus', 1, 2),
    ];
    expect(rulesChangeLines(changes, en, { privateFormula: true })).toEqual([
      'The scoring formula changed',
      'Win bonus: 1 → 2',
    ]);
    expect(rulesChangeLines(changes, fr, { privateFormula: true })[0]).toBe(
      'La formule de score a changé',
    );
    // Without it (the admin dialog, a built-in on both sides) each part keeps its own line.
    expect(rulesChangeLines(changes, en)).toHaveLength(5);
  });

  it('words a version move of the engine as how a bout ends', () => {
    const changes = [change('engine', 'TF_v1@1.0.0', 'TF_v1@1.1.0')];
    expect(rulesChangeLines(changes, en)).toEqual(['How a bout ends changed']);
    expect(rulesChangeLines(changes, fr)).toEqual(['Modification : Règles de fin de combat']);
  });

  it('reads a path this build does not know as another setting, once', () => {
    const changes = [
      change('unknown', {}, {}),
      { path: 'matchFormat.newSetting' as string as RulesChangePath, before: 1, after: 2 },
    ];
    expect(rulesChangeLines(changes, en)).toEqual(['Another scoring setting changed']);
  });
});

describe('sameTournamentName', () => {
  it('ignores case and runs of whitespace', () => {
    expect(sameTournamentName('Épée  Dames', 'épée dames')).toBe(true);
    expect(sameTournamentName('  Épée Dames\t', 'Épée Dames')).toBe(true);
    expect(sameTournamentName('Épée\t\tDames', 'ÉPÉE DAMES')).toBe(true);
  });

  it('keeps accents', () => {
    expect(sameTournamentName('Épée Dames', 'Epee dames')).toBe(false);
  });

  it('reads an accent typed as a combining mark as the same accent', () => {
    expect(sameTournamentName('Épée Dames', 'Épée Dames')).toBe(true);
  });

  it('tells two names apart', () => {
    expect(sameTournamentName('Épée Dames', 'Épée Hommes')).toBe(false);
    expect(sameTournamentName('Épée Dames', '')).toBe(false);
  });
});
