import { describe, expect, it } from 'vitest';
import { bestOfOptions } from './best-of-options';

/** A translator that names the key and its values, so the test sees which words were asked for. */
const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const values = (options: Array<{ value: string }>) => options.map((o) => o.value);

describe('bestOfOptions', () => {
  it('offers a single round and best of 3, 5 and 7', () => {
    expect(values(bestOfOptions(t))).toEqual(['1', '3', '5', '7']);
    expect(bestOfOptions(t)[0]?.label).toBe('organizer.tournaments.settings.bestOfSingle');
  });

  it('adds a held best-of the list lacks, in order, in words of its own', () => {
    const options = bestOfOptions(t, 9, 3, undefined, 9);
    expect(values(options)).toEqual(['1', '3', '5', '7', '9']);
    expect(options[4]?.label).toBe('organizer.tournaments.settings.bestOfN:{"n":9}');
  });

  it('adds every held value, the value in force and what the ruleset starts from', () => {
    expect(values(bestOfOptions(t, 11, 9))).toEqual(['1', '3', '5', '7', '9', '11']);
  });
});
