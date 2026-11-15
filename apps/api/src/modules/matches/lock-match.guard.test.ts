import { describe, expect, it } from 'vitest';
import { MatchesService } from './matches.service';

/**
 * The auto lock's write re-checks what its decision read (rulings 809, 813). The scan reads every
 * Match once, decides per group, then writes Match by Match. Between that read and a write an
 * organiser may unlock a Match, or reset a bout (status back to 'scheduled', lock cleared). An
 * UPDATE keyed by id alone then locked a Match nobody meant to lock again. The write now matches
 * only a Match still unlocked and still completed or voided; any other answers null, writes
 * nothing and throws nothing.
 */

type Call = [string, ...unknown[]];

/** A PostgREST builder that records its chain and answers `rows` at the end of it. */
function recordingSupabase(rows: unknown[]) {
  const calls: Call[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['update', 'eq', 'is', 'in', 'select']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  // `.single()` refuses 0 rows (PGRST116); `.maybeSingle()` answers null for them.
  builder['single'] = () => {
    calls.push(['single']);
    return Promise.resolve(
      rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no row' } },
    );
  };
  builder['maybeSingle'] = () => {
    calls.push(['maybeSingle']);
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  };
  const from = (table: string) => {
    calls.push(['from', table]);
    return builder;
  };
  return { supabase: { service: { from } }, calls };
}

function service(rows: unknown[]) {
  const { supabase, calls } = recordingSupabase(rows);
  const matches = new MatchesService(
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { matches, calls };
}

describe('MatchesService.lockMatch (the auto lock)', () => {
  it('writes only a Match still unlocked and still completed or voided', async () => {
    const { matches, calls } = service([{ id: 'match-1', locked_at: 'now' }]);

    const row = await matches.lockMatch(
      'match-1',
      'Auto lock after completed group',
      undefined,
      'auto',
    );

    expect(row).toEqual({ id: 'match-1', locked_at: 'now' });
    expect(calls.filter(([method]) => method !== 'update')).toEqual([
      ['from', 'matches'],
      ['eq', 'id', 'match-1'],
      ['is', 'locked_at', null],
      ['in', 'status', ['completed', 'voided']],
      ['select', '*'],
      ['maybeSingle'],
    ]);
    const update = calls.find(([method]) => method === 'update')?.[1] as Record<string, unknown>;
    expect(update).toMatchObject({
      lock_source: 'auto',
      lock_reason: 'Auto lock after completed group',
    });
    expect(typeof update['locked_at']).toBe('string');
  });

  it('answers null, with no error, when the Match changed since the scan read it', async () => {
    const { matches } = service([]);

    await expect(
      matches.lockMatch('match-1', 'Auto lock after completed group', undefined, 'auto'),
    ).resolves.toBeNull();
  });
});
