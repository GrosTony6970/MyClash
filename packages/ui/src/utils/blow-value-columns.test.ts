import { describe, expect, it } from 'vitest';
import { blowCount, blowValueColumns, blowValuesPresent } from './blow-value-columns';

const FIXED: { valuation: 'fixed'; fixedValue: number } = { valuation: 'fixed', fixedValue: 1 };

const counts = (value: number, over: Partial<Record<string, number>> = {}) => ({
  value,
  hitsGiven: 0,
  afterblowGiven: 0,
  hitsReceived: 0,
  afterblowReceived: 0,
  ...over,
});

const fighter = (...values: ReturnType<typeof counts>[]) => ({ byValue: values });

describe('blowValuesPresent', () => {
  it('unions every value across the table, ascending', () => {
    // One column set spans the table: a value only one fighter ever scored
    // still gets a column, and everyone else shows 0 in it.
    expect(blowValuesPresent([fighter(counts(2)), fighter(counts(7), counts(1))])).toEqual([
      1, 2, 7,
    ]);
  });

  it('includes a value ABOVE 3, which the fixed columns could not show', () => {
    // The defect: hits were bucketed into 1, 2 and 3 only, so a target worth 4
    // or more was invisible in every blow column.
    expect(blowValuesPresent([fighter(counts(4), counts(10))])).toEqual([4, 10]);
  });

  it('is empty when nobody has landed a blow yet', () => {
    expect(blowValuesPresent([fighter()])).toEqual([]);
  });
});

describe('blowValueColumns', () => {
  it('keeps the familiar four columns for a 1-and-2 tournament', () => {
    // The common case must render exactly what it always did.
    const columns = blowValueColumns([fighter(counts(1), counts(2))], FIXED);
    expect(columns.map((c) => c.label)).toEqual([
      '✓1',
      '✓1-1',
      '✓2',
      '✓2-1',
      '✗1',
      '✗1-1',
      '✗2',
      '✗2-1',
    ]);
  });

  it("heads the afterblow column with the ruleset's OWN flat worth", () => {
    // `-1` was hardcoded. A ruleset that values an afterblow at 2 must say 2.
    const columns = blowValueColumns([fighter(counts(3))], { valuation: 'fixed', fixedValue: 2 });
    expect(columns.map((c) => c.label)).toEqual(['✓3', '✓3-2', '✗3', '✗3-2']);
  });

  it('claims no worth under a weighted ruleset', () => {
    // Weighted means the retaliation is worth whatever it hit, so no single
    // number can head the column.
    const columns = blowValueColumns([fighter(counts(2))], {
      valuation: 'weighted',
      fixedValue: null,
    });
    expect(columns.map((c) => c.label)).toEqual(['✓2', '✓2-?', '✗2', '✗2-?']);
    expect(columns.filter((c) => c.worthUnknown).map((c) => c.kind)).toEqual([
      'afterblowGiven',
      'afterblowReceived',
    ]);
  });

  it('never heads two columns the same', () => {
    // `✓2` for the afterblow column under `weighted` would collide with the
    // clean-hit column beside it, which is why the suffix is `?` and not blank.
    const columns = blowValueColumns([fighter(counts(1), counts(2))], {
      valuation: null,
      fixedValue: null,
    });
    const labels = columns.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('marks only the afterblow columns as claiming an unknown worth', () => {
    const columns = blowValueColumns([fighter(counts(2))], FIXED);
    expect(columns.every((c) => !c.worthUnknown)).toBe(true);
  });

  it('renders no blow columns at all before the first blow', () => {
    expect(blowValueColumns([fighter()], FIXED)).toEqual([]);
  });
});

describe('blowCount', () => {
  it("reads the count for the column's value and kind", () => {
    const byValue = [counts(2, { hitsGiven: 5, afterblowReceived: 2 })];
    expect(blowCount(byValue, { value: 2, kind: 'hitsGiven' })).toBe(5);
    expect(blowCount(byValue, { value: 2, kind: 'afterblowReceived' })).toBe(2);
  });

  it('is 0 for a value this fighter never scored at', () => {
    // The API omits the entry rather than sending a zero row, so every fighter
    // still fills every column in the table.
    expect(blowCount([counts(1, { hitsGiven: 3 })], { value: 7, kind: 'hitsGiven' })).toBe(0);
  });
});
