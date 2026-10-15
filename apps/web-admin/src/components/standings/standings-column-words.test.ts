import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Generic_PointsCap, TF_v1 } from '@myclash/rulesets';
import { en, fr } from '@myclash/i18n';
import { STANDINGS_COLUMN_KEYS, standingsColumnLabel } from '@myclash/ui';

/**
 * Every standings column a ruleset or the Swiss service sends has a word in each language
 * (O20): a new stat that reached a screen or a file with its English label would pass the
 * translations' own tests, since the label is data.
 */
const SWISS_SERVICE = resolve(
  __dirname,
  '../../../../api/src/modules/swiss/swiss-standings.service.ts',
);

function swissColumnKeys(): string[] {
  const source = readFileSync(SWISS_SERVICE, 'utf8');
  const labels = /const TIEBREAK_LABELS[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? '';
  const tiebreaks = [...labels.matchAll(/(\w+):/g)].map((match) => match[1]!);
  const added = [...source.matchAll(/key: '(\w+)'/g)].map((match) => match[1]!);
  return [...tiebreaks, ...added];
}

describe('the words of the standings columns', () => {
  it('cover every column a ruleset or the Swiss service sends', () => {
    const sent = [
      ...TF_v1.standingsColumns.map((column) => column.key),
      ...Generic_PointsCap.standingsColumns.map((column) => column.key),
      ...swissColumnKeys(),
    ];
    expect(swissColumnKeys().length).toBeGreaterThan(4);
    expect(sent.filter((key) => !STANDINGS_COLUMN_KEYS.includes(key))).toEqual([]);
  });

  it('say each stat in the reader’s language, and keep a custom stat’s own label', () => {
    const say = (tree: unknown) => (key: string) =>
      key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree) as string;
    expect(standingsColumnLabel({ key: 'W', label: 'Wins' }, say(fr))).toBe('Victoires');
    expect(standingsColumnLabel({ key: 'W', label: 'Wins' }, say(en))).toBe('Wins');
    expect(standingsColumnLabel({ key: 'myStat', label: 'Style' }, say(fr))).toBe('Style');
    for (const key of STANDINGS_COLUMN_KEYS) {
      const word = standingsColumnLabel({ key, label: '' }, say(fr));
      expect(typeof word === 'string' && word.length > 0, key).toBe(true);
    }
  });
});
