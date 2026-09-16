/**
 * The doubles the organizer AI assistant's service tests share.
 *
 * Split out when `organizer-ai-assistant.service.test.ts` reached the 400-line
 * cap, so the draft cases and the apply cases can live in two files with one copy
 * of the doubles. Test-only: `apps/api/tsconfig.build.json` lists it by path, and
 * `scripts/check-test-code-leak.mjs` proves nothing in the emit imports it.
 *
 * Vitest gives each test file its own module registry, so the two files never
 * share these mocks at run time.
 */
import { vi, type Mock } from 'vitest';
import { OrganizerAIAssistantService } from './organizer-ai-assistant.service';

/**
 * A query builder whose filters chain and whose terminals resolve to one canned
 * result. Typed by hand: exported, its inferred type is too large for the
 * compiler to write out (TS7056).
 */
export interface Chain {
  select: Mock<(...args: unknown[]) => Chain>;
  eq: Mock<(...args: unknown[]) => Chain>;
  in: Mock<(...args: unknown[]) => Chain>;
  order: Mock<(...args: unknown[]) => Chain>;
  limit: Mock<(...args: unknown[]) => Chain>;
  insert: Mock<(...args: unknown[]) => Chain>;
  update: Mock<(...args: unknown[]) => Chain>;
  maybeSingle: Mock<() => Promise<unknown>>;
  single: Mock<() => Promise<unknown>>;
}

export const mockSupabaseFrom = vi.fn();
export const mockGenerateWithCap = vi.fn();
const mockAssertOrgRole = vi.fn();
export const mockCreateTournament = vi.fn();
export const mockGeneratePools = vi.fn();
const mockGenerateBracket = vi.fn();

const supabase = { service: { from: mockSupabaseFrom } };
const aiUsage = { generateWithCap: mockGenerateWithCap };
const orgs = { assertOrgRole: mockAssertOrgRole };
const events = { createTournament: mockCreateTournament };
const phases = {
  generatePools: mockGeneratePools,
  generateBracket: mockGenerateBracket,
};

export function chain(
  result: { data?: unknown; error?: unknown } = { data: null, error: null },
): Chain {
  const base: Chain = {
    select: vi.fn(() => base),
    eq: vi.fn(() => base),
    in: vi.fn(() => base),
    order: vi.fn(() => base),
    limit: vi.fn(() => base),
    insert: vi.fn(() => base),
    update: vi.fn(() => base),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return base;
}

/**
 * The one owner of putting a Match on a piste. `schedule_match` hands it a
 * batch; it checks the Lice, refuses a busy strip and refreshes the fighters'
 * alerts. Doubled here — its behaviour is `match-placement.service.test.ts`'s,
 * and what these cases own is the batch the assistant builds.
 */
export const placement = { placeMatches: vi.fn().mockResolvedValue(undefined) };

export function service() {
  return new OrganizerAIAssistantService(
    supabase as never,
    aiUsage as never,
    orgs as never,
    events as never,
    phases as never,
    placement as never,
  );
}

/** The state every case starts from: an organiser the org check lets through, and a pool-plan draft. */
export function resetHarness(): void {
  vi.clearAllMocks();
  mockAssertOrgRole.mockResolvedValue(undefined);
  mockGenerateWithCap.mockResolvedValue({
    text: JSON.stringify({
      summary: 'Use four balanced pools.',
      actions: [{ kind: 'generate_pools', tournamentId: 't-1', targetSize: 8 }],
      warnings: [],
    }),
    inputTokens: 20,
    outputTokens: 40,
    costEur: 0.01,
  });
}
