/**
 * The database double of the notice handlers' tests: each table answers one canned result, to
 * every read. Test-only: listed in tsconfig.build.json's exclude, proven by
 * scripts/check-test-code-leak.mjs.
 */
import { vi } from 'vitest';

function makeQuery(result: unknown) {
  const chain = Object.assign(Promise.resolve(result), {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    order: vi.fn(),
    limit: vi.fn(),
  });
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

export function makeSupabase(resultsByTable: Record<string, unknown>) {
  return {
    service: {
      from: vi.fn((table: string) =>
        makeQuery(resultsByTable[table] ?? { data: null, error: null }),
      ),
    },
  };
}
