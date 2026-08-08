/**
 * A PostgREST query-builder double for unit tests.
 *
 * Forty-two test files declare their own local `makeChain`, in thirty-five
 * genuinely different shapes. This is not (yet) a replacement for all of them —
 * each encodes real assumptions about which methods are terminal and which are
 * thenable, and rewriting them wholesale would risk silently weakening
 * assertions. It is the shape new tests should reach for.
 *
 * The reason it exists is not deduplication. It is that the prevailing idiom —
 * `from.mockReturnValueOnce(a).mockReturnValueOnce(b)` — is ORDER-DEPENDENT.
 * Insert a query anywhere upstream and every later result shifts by one; the
 * suite stays green while asserting against the wrong table. That desync is a
 * known defect class here (see the ordered sequences in matches.service tests).
 *
 * Routing by TABLE NAME removes the coupling: a new query on a different table
 * cannot shift anyone else's result, and a query against a table the test never
 * configured throws instead of quietly resolving to `{ data: null }` — which
 * would otherwise read as a passing "not found" branch.
 *
 * Note this module holds no table or column literals on purpose: everything is
 * a parameter. `db-schema-conformance.test.ts` scans this directory (its
 * `scanApiSources` skips only *.test.ts), so a literal `.from('x').select('a')`
 * here would enter the real (table, column) assertions.
 *
 * Test-only, and excluded from apps/api/tsconfig.build.json — but NOT covered by
 * the root eslint config's test-file relaxations, whose `**\/test\/**\/*.ts` glob
 * wants a directory named `test`, not `testing`. So this file is held to
 * production lint rules: no `any`.
 */
import { vi, type Mock } from 'vitest';

/** What a PostgREST call resolves to. */
export interface ChainResult {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

/** Filters and modifiers — each returns the builder, so chains nest freely. */
const CHAINABLE = [
  'select',
  'insert',
  'update',
  'upsert',
  'delete',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'is',
  'in',
  'contains',
  'overlaps',
  'not',
  'or',
  'filter',
  'match',
  'order',
  'limit',
  'range',
  'abortSignal',
  'returns',
  'throwOnError',
] as const;

/** Methods that resolve rather than chain. */
const TERMINAL = ['single', 'maybeSingle', 'csv'] as const;

type ChainMethod = (typeof CHAINABLE)[number] | (typeof TERMINAL)[number];

export type SupabaseChain = Record<ChainMethod, Mock> & PromiseLike<ChainResult>;

/**
 * One query builder resolving to `result`.
 *
 * Thenable as well as chainable, because both spellings appear in this codebase:
 * `await sb.from(t).select().eq(...)` and `await sb.from(t).select().single()`.
 */
export function supabaseChain(result: ChainResult = { data: null, error: null }): SupabaseChain {
  const settled = Promise.resolve(result);
  const chain = {
    then: settled.then.bind(settled),
    catch: settled.catch.bind(settled),
    finally: settled.finally.bind(settled),
  } as unknown as SupabaseChain;

  for (const method of CHAINABLE) chain[method] = vi.fn(() => chain);
  for (const method of TERMINAL) chain[method] = vi.fn(() => Promise.resolve(result));
  return chain;
}

/**
 * A `from()` mock that routes by table name.
 *
 * A bare `ChainResult` answers every call on that table. An ARRAY is a queue,
 * for the case where one table is queried repeatedly with different answers
 * (a loop, or a read-then-write pair); the last entry repeats once the queue is
 * down to one, so `[a]` and `a` mean the same thing.
 *
 * Querying an unconfigured table throws. Silence there is the failure mode this
 * whole module exists to avoid.
 */
export function supabaseFrom(
  byTable: Readonly<Record<string, ChainResult | ChainResult[]>>,
): Mock<(table: string) => SupabaseChain> {
  const queues = new Map<string, ChainResult[]>();
  for (const [table, value] of Object.entries(byTable)) {
    queues.set(table, Array.isArray(value) ? [...value] : [value]);
  }

  return vi.fn((table: string): SupabaseChain => {
    const queue = queues.get(table);
    if (!queue || queue.length === 0) {
      const configured = [...queues.keys()].sort().join(', ') || '(none)';
      throw new Error(
        `supabaseFrom: query against unconfigured table "${table}". Configured: ${configured}.`,
      );
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return supabaseChain(next);
  });
}

/**
 * A stand-in for SupabaseService. Cast at the call site:
 * `new Thing(mockSupabase({ phases: { data: [] } }) as unknown as SupabaseService)`.
 */
export function mockSupabase(byTable: Readonly<Record<string, ChainResult | ChainResult[]>>): {
  service: { from: Mock<(table: string) => SupabaseChain> };
  from: Mock<(table: string) => SupabaseChain>;
} {
  const from = supabaseFrom(byTable);
  return { service: { from }, from };
}

/** Tables a `from()` mock was actually asked for, in call order. */
export function queriedTables(from: Mock<(table: string) => SupabaseChain>): string[] {
  return from.mock.calls.map(([table]) => table);
}
