import { describe, expect, it } from 'vitest';
import { RetentionService, __testing } from './retention.service';

interface Deletion {
  table: string;
  column: string;
  cutoff: string;
}

function makeSupabase(settings: Record<string, unknown>) {
  const deletions: Deletion[] = [];
  const service = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: settings, error: null }),
        update: () => chain,
        delete: () => {
          const deleteChain: Record<string, unknown> = {
            lt: (column: string, cutoff: string) => {
              deletions.push({ table, column, cutoff });
              return deleteChain;
            },
            select: () => Promise.resolve({ data: [], error: null }),
          };
          return deleteChain;
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    },
  };
  return { supabase: { service } as never, deletions };
}

const BASE = {
  enabled: true,
  guest_session_days: 90,
  ai_usage_log_days: 365,
  broadcast_recipient_days: 365,
  audit_log_days: 0,
};

describe('RetentionService.runSweep', () => {
  it('leaves the audit log alone at the default horizon', async () => {
    const { supabase, deletions } = makeSupabase(BASE);
    await new RetentionService(supabase).runSweep();

    // 0 means keep forever. The audit log is a governance record; sweeping it
    // would destroy history about people who never asked for erasure.
    expect(deletions.some((d) => d.table === 'audit_log')).toBe(false);
  });

  it('sweeps the audit log only once an operator sets a horizon', async () => {
    const { supabase, deletions } = makeSupabase({ ...BASE, audit_log_days: 730 });
    await new RetentionService(supabase).runSweep();
    expect(deletions.some((d) => d.table === 'audit_log')).toBe(true);
  });

  it('uses each table’s real timestamp column, which is not uniform', async () => {
    const { supabase, deletions } = makeSupabase(BASE);
    await new RetentionService(supabase).runSweep();

    const column = (table: string) => deletions.find((d) => d.table === table)?.column;
    // ai_usage_log is the odd one out; assuming created_at here would 400 the
    // query and read as "nothing old enough to delete".
    expect(column('ai_usage_log')).toBe('called_at');
    expect(column('platform_ai_usage_log')).toBe('created_at');
    expect(column('fighter_ai_usage_log')).toBe('created_at');
    expect(column('guest_sessions')).toBe('expires_at');
  });

  it('always sweeps expired claim tokens, with no configurable horizon', async () => {
    const { supabase, deletions } = makeSupabase(BASE);
    await new RetentionService(supabase).runSweep();
    expect(deletions.some((d) => d.table === 'global_person_claim_tokens')).toBe(true);
  });

  it('does nothing at all when disabled', async () => {
    const { supabase, deletions } = makeSupabase({ ...BASE, enabled: false });
    const removed = await new RetentionService(supabase).runSweep();
    expect(deletions).toEqual([]);
    expect(removed).toEqual({});
  });

  it('computes the cutoff from the horizon in days', async () => {
    const { supabase, deletions } = makeSupabase(BASE);
    const before = Date.now();
    await new RetentionService(supabase).runSweep();

    const guest = deletions.find((d) => d.table === 'guest_sessions');
    const ageMs = before - new Date(guest!.cutoff).getTime();
    expect(ageMs).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(91 * 24 * 60 * 60 * 1000);
  });

  it('never sweeps a table holding competition results', async () => {
    // Results are a public record (Art. 17(3)) and must not have a horizon at
    // all — not even one an operator could set by accident.
    const swept = new Set(__testing.SWEEPS.map((s) => s.table));
    for (const table of ['matches', 'match_events', 'registrations', 'persons', 'global_persons']) {
      expect(swept.has(table), `${table} must never be swept`).toBe(false);
    }
  });
});
