/**
 * The blow table's columns, derived from the data instead of declared.
 *
 * The per-fighter blow table (the lyonamhe.fr layout, rendered by both the
 * public tournament stats page and the organizer event-statistics surface) used
 * to hardcode one pair of columns per point value: ✓1, ✓1-1, ✓2, ✓2-1 and the
 * ✗ mirrors, later with a ✓3 pair behind a `hasV3` flag. A target may be worth
 * 1 to 10, so anything above 3 had no column to appear in.
 *
 * The API now returns each fighter's counts keyed by the value that occurred
 * (migration 0189), so the column set is read off the data. A tournament that
 * only ever scored 1s and 2s renders exactly the four columns it always did.
 *
 * ── The afterblow heading ───────────────────────────────────────────────────
 * `✓2-1` means "struck for 2, took an afterblow worth 1". That trailing 1 was
 * hardcoded, and it is one federation's rule: FFAMHE values every afterblow at
 * a flat 1 (`afterblowValuation: 'fixed'`). A ruleset may instead declare
 * `weighted`, where the retaliation is worth whatever target it hit — so no
 * single number can head the column, and the old label simply asserted 1.
 *
 * Under `weighted`, and whenever the ruleset's valuation is unknown, the
 * suffix is `?` rather than a number. `✓2` is NOT used for that column: it is
 * already the heading of the clean-hit column beside it, and two columns headed
 * the same is worse than an honest question mark. `?` is a symbol, so it needs
 * no translation; render `afterblowWorthUnknownTitle` as its tooltip.
 */

/** Which of the four counts a column shows. */
export type BlowKind = 'hitsGiven' | 'afterblowGiven' | 'hitsReceived' | 'afterblowReceived';

/** One fighter's four blow counts at one point value. */
export interface BlowValueCounts {
  value: number;
  hitsGiven: number;
  afterblowGiven: number;
  hitsReceived: number;
  afterblowReceived: number;
}

/** How the tournament's ruleset values an afterblow. */
export interface AfterblowRule {
  valuation: 'fixed' | 'weighted' | null;
  fixedValue: number | null;
}

export interface BlowColumn {
  /** The point value this column reports on. */
  value: number;
  kind: BlowKind;
  /** Column heading, e.g. `✓2`, `✓2-1`, `✗2-?`. */
  label: string;
  /** True when the heading claims no worth for the retaliation. */
  worthUnknown: boolean;
}

/** The heading suffix for an afterblow column: the flat worth, or `?`. */
function afterblowSuffix(afterblow: AfterblowRule): string | null {
  if (afterblow.valuation === 'fixed' && afterblow.fixedValue != null) {
    return String(afterblow.fixedValue);
  }
  return null;
}

/**
 * Every point value that appears in any fighter's counts, ascending.
 *
 * Taken across ALL fighters rather than per fighter, so one column set spans
 * the table: a value only one fighter ever scored still gets a column, and
 * everyone else shows 0 in it.
 */
export function blowValuesPresent(
  fighters: ReadonlyArray<{ byValue: ReadonlyArray<{ value: number }> }>,
): number[] {
  const values = new Set<number>();
  for (const fighter of fighters) {
    for (const counts of fighter.byValue) values.add(counts.value);
  }
  return [...values].sort((a, b) => a - b);
}

/**
 * The ordered blow columns: every given column for every value, then every
 * received column — the order the table has always used, generalised.
 */
export function blowValueColumns(
  fighters: ReadonlyArray<{ byValue: ReadonlyArray<{ value: number }> }>,
  afterblow: AfterblowRule,
): BlowColumn[] {
  const values = blowValuesPresent(fighters);
  const suffix = afterblowSuffix(afterblow);
  const worthUnknown = suffix === null;
  const shown = suffix ?? '?';

  const columnsFor = (mark: '✓' | '✗', hit: BlowKind, afterblowKind: BlowKind): BlowColumn[] =>
    values.flatMap((value) => [
      { value, kind: hit, label: `${mark}${value}`, worthUnknown: false },
      {
        value,
        kind: afterblowKind,
        label: `${mark}${value}-${shown}`,
        worthUnknown,
      },
    ]);

  return [
    ...columnsFor('✓', 'hitsGiven', 'afterblowGiven'),
    ...columnsFor('✗', 'hitsReceived', 'afterblowReceived'),
  ];
}

/**
 * One fighter's count for a column. Zero when that fighter never scored at that
 * value — the API omits the entry rather than sending a zero row.
 */
export function blowCount(
  byValue: ReadonlyArray<BlowValueCounts>,
  column: Pick<BlowColumn, 'value' | 'kind'>,
): number {
  return byValue.find((counts) => counts.value === column.value)?.[column.kind] ?? 0;
}
