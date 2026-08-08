import { describe, expect, it } from 'vitest';
import { isEventUuid, resolveEventId } from './event-ref';
import { mockSupabase, queriedTables } from './testing/supabase-chain';

const UUID = '3f1a2b3c-4d5e-4f60-8a91-0b1c2d3e4f50';

describe('isEventUuid', () => {
  it('accepts a real event id', () => {
    expect(isEventUuid(UUID)).toBe(true);
  });

  it.each([
    ['a slug', 'fal-2026'],
    ['a slug that looks numeric', '2026'],
    ['a slug with hyphens in UUID-ish places', 'abc-defg-hijk'],
    ['empty', ''],
  ])('rejects %s so it is resolved as a slug', (_label, ref) => {
    expect(isEventUuid(ref)).toBe(false);
  });
});

describe('resolveEventId', () => {
  it('returns a UUID unchanged without touching the database', async () => {
    const supabase = mockSupabase({});

    await expect(resolveEventId(supabase as never, UUID)).resolves.toBe(UUID);
    expect(queriedTables(supabase.from)).toEqual([]);
  });

  it('looks a slug up — the case every /e/<slug>/ caller actually sends', async () => {
    const supabase = mockSupabase({ events: { data: { id: UUID }, error: null } });

    await expect(resolveEventId(supabase as never, 'fal-2026')).resolves.toBe(UUID);
    expect(queriedTables(supabase.from)).toEqual(['events']);
  });

  it('404s on a slug that names no event', async () => {
    const supabase = mockSupabase({ events: { data: null, error: null } });

    await expect(resolveEventId(supabase as never, 'no-such-event')).rejects.toThrow(/not found/i);
  });
});
