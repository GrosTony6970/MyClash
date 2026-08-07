import { BadRequestException } from '@nestjs/common';

/**
 * Client-side SUM/COUNT over a filtered PostgREST query.
 *
 * ## Why this exists
 *
 * PostgREST rejects server-side aggregate functions (`cost_eur.sum()`,
 * `id.count()`) unless `db-aggregates-enabled` is turned on, and it has
 * defaulted to OFF since PostgREST 12 — which this stack pins (`v12.2.3` in
 * both `infra/docker-compose.prod.yml` and `.dev.yml`) without setting the
 * flag. The flag is deliberately left off: web-public talks to PostgREST
 * directly as `anon`, and enabling aggregates would let an anonymous caller run
 * them over every RLS-exposed table.
 *
 * Every aggregate query in the AI stack therefore failed, and all but one
 * destructured `{ data }` while dropping `error` — so each returned 0 and, in
 * production, EVERY AI budget and spend cap silently read zero spend and never
 * fired. Found by `tests/e2e/31-ai-generation.spec.ts`, whose meter assertion
 * compared a JS-aggregated rollup (8 calls) against the aggregate query for the
 * same event (0 calls).
 *
 * So: aggregate in JS, page so a large window stays correct, and never swallow
 * the error.
 *
 * @param page   Runs one page of the query. The caller applies its own filters
 *               and calls `.range(from, to)` with the supplied bounds.
 * @param column Numeric column to total. `NUMERIC` arrives from PostgREST as a
 *               string, so it is parsed rather than trusted as a number.
 */
export async function sumAndCount(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  column: string,
): Promise<{ total: number; count: number }> {
  const PAGE = 1000;
  // Matches fetchUsageRows' ceiling: a bound high enough never to be reached by
  // a real month of usage, low enough that a runaway filter cannot page forever.
  const MAX_ROWS = 100_000;

  let total = 0;
  let count = 0;

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) throw new BadRequestException(error.message);
    // A filtered (non-`.single()`) PostgREST read always returns an array; treat
    // anything else as empty rather than throwing an opaque TypeError deep in
    // the loop.
    const batch = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    for (const row of batch) {
      total += toNumber(row[column]);
      count += 1;
    }
    if (batch.length < PAGE) break;
  }

  return { total, count };
}

/** Count only — same paging and the same refusal to swallow an error. */
export async function countRows(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<number> {
  return (await sumAndCount(page, '__none__')).count;
}

/** PostgREST returns NUMERIC as a string; anything unparseable counts as 0. */
function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
