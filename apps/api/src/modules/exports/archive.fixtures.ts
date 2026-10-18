/**
 * The archive service over seeded tables, for its tests: reads narrow the seeded rows as PostgREST
 * would, inserts are recorded per table (and change no seeded table). Imported by tests and
 * nothing else; split out of `archive.service.test.ts` when the restore of an older archive got a
 * test file of its own (`archive-match-rules.test.ts`).
 */
import { vi } from 'vitest';
import { supabaseRpc, type RpcAnswer } from '../../common/testing/supabase-chain';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { ArchiveService } from './archive.service';

export type TableRows = Record<string, Record<string, unknown>[]>;

/** The chain, awaited, answers as PostgREST does: one read stops at 1000 rows, with no word. */
function answersAsPostgrest<T extends { current: unknown[] }>(chain: T): T {
  Object.defineProperty(chain, 'then', {
    value: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: chain.current.slice(0, 1000), error: null })),
    enumerable: false,
  });
  return chain;
}

type Row = Record<string, unknown>;

/**
 * The read half of the chain: each call narrows `current` as PostgREST would. `order` keeps the
 * rows as given (a fixture lists them in key order); `gt` compares as text, as a uuid compares.
 */
function readsOf<T extends { current: Row[] }>(chain: T) {
  const narrow = (pick: (rows: Row[]) => Row[]) => {
    chain.current = pick(chain.current);
    return chain;
  };
  return {
    eq: vi.fn((column: string, value: unknown) =>
      narrow((rows) => rows.filter((row) => row[column] === value)),
    ),
    in: vi.fn((column: string, values: unknown[]) =>
      narrow((rows) => rows.filter((row) => values.includes(row[column]))),
    ),
    gt: vi.fn((column: string, value: unknown) =>
      narrow((rows) => rows.filter((row) => String(row[column]) > String(value))),
    ),
    order: vi.fn(() => chain),
    range: vi.fn((start: number, end: number) => narrow((rows) => rows.slice(start, end + 1))),
    limit: vi.fn((count: number) => narrow((rows) => rows.slice(0, count))),
  };
}

/**
 * `byFunction` answers the database functions a restore calls (`supabaseRpc`: a function not
 * named throws). Without it every call answers nothing.
 */
function makeSupabase(rows: TableRows, byFunction?: Readonly<Record<string, RpcAnswer>>) {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const from = vi.fn((table: string) => {
    const tableRows = rows[table] ?? [];
    const chain = {
      select: vi.fn(() => chain),
      insert: vi.fn((payload: Record<string, unknown> | Record<string, unknown>[]) => {
        const items = Array.isArray(payload) ? payload : [payload];
        inserted[table] = [...(inserted[table] ?? []), ...items];
        chain.current = items;
        return chain;
      }),
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data: chain.current[0] ?? null,
          error: null as { message: string } | null,
        }),
      ),
      single: vi.fn(() =>
        Promise.resolve({
          data: chain.current[0] ?? null,
          error: null as { message: string } | null,
        }),
      ),
      current: [...tableRows],
      then: undefined as unknown,
    };
    return answersAsPostgrest(Object.assign(chain, readsOf(chain)));
  });
  const rpc = byFunction
    ? supabaseRpc(byFunction)
    : vi.fn(() => Promise.resolve({ data: null, error: null }));

  return { supabase: { service: { from, rpc } }, inserted, rpc };
}

export function makeService(
  rows: TableRows = {},
  byFunction?: Readonly<Record<string, RpcAnswer>>,
) {
  const { supabase, inserted, rpc } = makeSupabase(rows, byFunction);
  const orgs = { assertOrgRole: vi.fn(() => Promise.resolve()) };
  return {
    // Every club pair in these archives may be kept (`archive-rulesets.test.ts` has the refusal).
    service: new ArchiveService(supabase as never, orgs as never, createRulesetRegistry(), {
      draftsOfferedTo: vi.fn(async () => false),
      restorable: vi.fn(async () => true),
    } as never),
    orgs,
    inserted,
    rpc,
  };
}
