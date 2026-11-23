import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { FightBookSettingsService } from './fightbook-settings.service';

// Split from fightbook-settings.service.test.ts (its 400-line budget): switching FightBook off.
const NOW = new Date();
const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const live = (enabled: boolean) => ({ userId: ACCOUNT, globalPersonId: MARC, enabled });

describe('switching off takes the caller off the floor', () => {
  const FOE = '3e2f6d85-0a8c-4d8a-8c88-4e4e6c8f5d34';
  function floorService(overrides: Record<string, unknown> = {}) {
    const supabase = mockSupabase({
      global_persons: {
        data: { fightbook_enabled: false, fightbook_show_stars: false },
        error: null,
      },
      spar_requests: { data: [], error: null, count: 3 },
      fightbook_daily_limits: { rows: [] },
      fightbook_free_now: {
        rows: [
          { id: 'fn-1', global_person_id: MARC },
          { id: 'fn-2', global_person_id: FOE },
        ],
      },
      fightbook_qr_codes: {
        rows: [
          { id: 'q-1', global_person_id: MARC },
          { id: 'q-2', global_person_id: FOE },
        ],
      },
      spar_open_call_answers: {
        rows: [
          { id: 'oa-1', answerer_global_person_id: MARC },
          { id: 'oa-2', answerer_global_person_id: FOE },
        ],
      },
      spar_open_calls: {
        rows: [
          { id: 'c-1', poster_global_person_id: MARC, status: 'open' },
          { id: 'c-2', poster_global_person_id: MARC, status: 'picked' },
          { id: 'c-3', poster_global_person_id: FOE, status: 'open' },
        ],
      },
      ...overrides,
    } as never);
    return supabase;
  }
  const build = (overrides: Record<string, unknown> = {}) => {
    const supabase = floorService(overrides);
    return { settings: new FightBookSettingsService(supabase as never), supabase };
  };

  it("deletes the caller's free-now row, codes and answers, each scoped to the caller", async () => {
    const { settings, supabase } = build();
    await settings.set(live(true), { enabled: false }, NOW);
    expect(filtersFor(supabase.from, 'fightbook_free_now', 'eq')).toEqual([
      ['global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'fightbook_qr_codes', 'eq')).toEqual([
      ['global_person_id', MARC],
    ]);
    expect(filtersFor(supabase.from, 'spar_open_call_answers', 'eq')).toEqual([
      ['answerer_global_person_id', MARC],
    ]);
    for (const table of ['fightbook_free_now', 'fightbook_qr_codes', 'spar_open_call_answers']) {
      expect(writesTo(supabase, table).map((w) => w.op)).toEqual(['delete']);
    }
  });

  it("closes only the caller's OPEN calls", async () => {
    const { settings, supabase } = build();
    await settings.set(live(true), { enabled: false }, NOW);
    const [close] = writesTo(supabase, 'spar_open_calls');
    expect(close?.op).toBe('update');
    expect(close?.row).toEqual({ status: 'closed' });
    expect(filtersFor(supabase.from, 'spar_open_calls', 'eq')).toEqual([
      ['poster_global_person_id', MARC],
      ['status', 'open'],
    ]);
  });

  it('switching on, or saving the stars switch alone, touches no floor row', async () => {
    const { settings, supabase } = build();
    await settings.set(live(false), { enabled: true }, NOW);
    await settings.set(live(true), { showStars: true }, NOW);
    for (const table of [
      'fightbook_free_now',
      'fightbook_qr_codes',
      'spar_open_call_answers',
      'spar_open_calls',
    ]) {
      expect(writesTo(supabase, table), table).toEqual([]);
    }
  });

  it.each([
    ['fightbook_free_now', 'its free-now mark stays'],
    ['fightbook_qr_codes', 'its QR codes stay'],
    ['spar_open_call_answers', 'its open-call answers stay'],
    ['spar_open_calls', 'its open calls stay'],
  ])('a failed %s write throws, naming what stays', async (table, what) => {
    const { settings } = build({ [table]: { data: null, error: { message: 'boom' } } });
    await expect(settings.set(live(true), { enabled: false }, NOW)).rejects.toThrow(
      `FightBook is off, but ${what}: boom`,
    );
  });
});
