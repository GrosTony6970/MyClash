import { vi } from 'vitest';
import { PublicScheduleService } from './public-schedule.service';

/**
 * The person schedule's seeded rows, for `public-schedule.service.test.ts`. Split
 * out when that file reached the 400-line cap, the shape
 * `schedule/schedule-run.fixtures.ts` already sets. It imports vitest, so
 * `tsconfig.build.json` excludes it by path.
 */

/**
 * Thenable query chain: every builder method returns the same object, which
 * also resolves. Mirrors me-events.list.test.
 */
export type Chain = Promise<unknown> & Record<string, ReturnType<typeof vi.fn>>;
export function q(result: unknown): Chain {
  const promise = Promise.resolve(result) as Chain;
  for (const m of ['select', 'eq', 'in', 'neq', 'order', 'or', 'not', 'maybeSingle']) {
    promise[m] = vi.fn(() => promise);
  }
  return promise;
}

/** A projection with its layout whitespace collapsed, so it compares exactly. */
export const projection = (chain: Chain | undefined): string =>
  String(chain?.select?.mock.calls[0]?.[0] ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export const PHASE = {
  visibility_status: 'published',
  type: 'pool',
  config_json: null,
  tournaments: { name: 'Longsword Open', slug: 'longsword-open' },
};

/** A match-scoped duty. Its Match sits in a Pool, which the duty does NOT cover. */
export const matchScoped = (id: string, scheduledAt: string | null, phase: unknown = PHASE) => ({
  id,
  role: 'referee_table',
  pool_id: null,
  match_id: `m-${id}`,
  pools: null,
  lices: null,
  matches: {
    id: `m-${id}`,
    match_number_label: id,
    scheduled_at: scheduledAt,
    bracket_slot_id: null,
    pools: { id: 'pool-of-the-match', name: 'Pool 9' },
    lices: null,
    phases: phase,
  },
});

/** A pool-scoped duty ("Déclarant"): no match, so its time comes from its Pool. */
export const poolScoped = (id: string) => ({
  id,
  role: 'referee_declarant',
  pool_id: 'pool-1',
  match_id: null,
  pools: { id: 'pool-1', name: 'Pool 1', phases: PHASE },
  lices: null,
  matches: null,
});

export function buildService(
  assignments: unknown,
  opts: { timezone?: string | null; registrations?: unknown[]; matches?: unknown[] } = {},
) {
  const chains = new Map<string, Chain[]>();
  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        const chain =
          table === 'referee_assignments'
            ? q(assignments)
            : table === 'persons'
              ? q({ data: { global_person_id: 'gp-1' }, error: null })
              : table === 'events'
                ? q({ data: opts.timezone ? { timezone: opts.timezone } : null, error: null })
                : table === 'registrations'
                  ? q({ data: opts.registrations ?? [], error: null })
                  : table === 'matches'
                    ? q({ data: opts.matches ?? [], error: null })
                    : q({ data: [], error: null });
        chains.set(table, [...(chains.get(table) ?? []), chain]);
        return chain;
      }),
    },
  };
  const privacy = { canSeeWorkshops: vi.fn(async () => false) };
  return {
    // No `orgs`: `getSchedule` gates nothing — the public door's gate has its own file.
    service: new PublicScheduleService(supabase as never, privacy as never, {} as never),
    supabase,
    chains,
  };
}

export const rows = (data: unknown[]) => ({ data, error: null });

/** One of the fighter's own bouts, as the Match read returns it. */
export const fighterMatch = (
  id: string,
  override: number | null,
  visibility = 'published',
  pool: { id: string; name: string } | null = null,
) => ({
  id,
  match_number_label: id,
  status: 'scheduled',
  scheduled_at: '2027-05-22T10:00:00Z',
  phase_id: `phase-${id}`,
  pool_id: pool?.id ?? null,
  planned_duration_override_minutes: override,
  red_score: 0,
  blue_score: 0,
  winner_registration_id: null,
  end_reason: null,
  red_registration_id: 'reg-1',
  blue_registration_id: 'reg-2',
  pools: pool ? { name: pool.name } : null,
  lice_id: `lice-${id}`,
  lices: null,
  phases: {
    visibility_status: visibility,
    type: 'pool',
    tournaments: { id: 't-1', name: 'Open' },
  },
});
