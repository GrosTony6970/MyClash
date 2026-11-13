import { ForbiddenException, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { settingsSchema } from './fightbook.controller';
import { FightBookSettingsService } from './fightbook-settings.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const LEA = '2d1e5c74-9f7b-4c79-9b77-3d3d5b7e4c03';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const live = (enabled: boolean) => ({ userId: ACCOUNT, globalPersonId: MARC, enabled });
const STARS = { average: 4.5, count: 2 };

/** Another profile's limit: the read must never return it. */
const LEA_LIMIT_ROW = { id: 'l-2', global_person_id: LEA, daily_limit: 7 };

function service(saved: boolean, showStars = false, limit: number | null = null) {
  const supabase = mockSupabase(
    {
      global_persons: {
        data: { fightbook_enabled: saved, fightbook_show_stars: showStars },
        error: null,
      },
      fightbook_daily_limits: {
        rows:
          limit === null
            ? [LEA_LIMIT_ROW]
            : [LEA_LIMIT_ROW, { id: 'l-1', global_person_id: MARC, daily_limit: limit }],
      },
      spar_requests: { data: [], error: null, count: 3 },
      fightbook_free_now: { rows: [] },
      fightbook_qr_codes: { rows: [] },
      spar_open_call_answers: { rows: [] },
      spar_open_calls: { rows: [] },
    },
    { fightbook_star_line: () => ({ data: STARS, error: null }) },
  );
  return { settings: new FightBookSettingsService(supabase as never), supabase };
}

describe('settingsSchema', () => {
  it('takes either switch or both, and refuses an empty body or a stray key', () => {
    expect(settingsSchema.safeParse({ showStars: true }).success).toBe(true);
    expect(settingsSchema.safeParse({ enabled: false, showStars: false }).success).toBe(true);
    expect(settingsSchema.safeParse({}).success).toBe(false);
    expect(settingsSchema.safeParse({ fightbook_show_stars: true }).success).toBe(false);
  });

  it('takes a whole daily limit from 1 to 20, or null, and refuses the rest', () => {
    for (const ok of [null, 1, 20, 3]) {
      expect(settingsSchema.safeParse({ dailyLimit: ok }).success, String(ok)).toBe(true);
    }
    for (const bad of [0, 21, 2.5, '3']) {
      expect(settingsSchema.safeParse({ dailyLimit: bad }).success, String(bad)).toBe(false);
    }
    expect(settingsSchema.safeParse({}).success).toBe(false);
  });
});

describe('FightBookSettingsService', () => {
  it('answers the switches and the caller’s own line, stars shown whatever the switch', async () => {
    const { settings, supabase } = service(true, false);
    expect(await settings.get(live(true))).toEqual({
      hasProfile: true,
      enabled: true,
      showStars: false,
      dailyLimit: null,
      sparred: 3,
      stars: STARS,
    });
    expect(selectsFor(supabase.from, 'global_persons')).toEqual(['fightbook_show_stars']);
    expect(filtersFor(supabase.from, 'global_persons', 'eq')).toEqual([['id', MARC]]);
    // The own line is the caller's: never anyone else's.
    expect(supabase.rpc.mock.calls[0]![1]).toEqual({ p_subject: MARC });
    expect(filtersFor(supabase.from, 'spar_requests', 'or')).toEqual([
      [`asker_global_person_id.eq.${MARC},receiver_global_person_id.eq.${MARC}`],
    ]);
  });

  describe('when the own line cannot be read, the rest of the settings still answers', () => {
    const boom = { data: null, error: { message: 'boom' } };
    it.each([
      ['count', 'sparred count failed'],
      ['star', 'star line read failed'],
    ] as const)('a failed %s read answers no line and logs one warning', async (failure, step) => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const supabase = mockSupabase(
        {
          global_persons: { data: { fightbook_show_stars: true }, error: null },
          fightbook_daily_limits: { rows: [] },
          spar_requests: failure === 'count' ? boom : { data: [], error: null, count: 3 },
        },
        { fightbook_star_line: () => (failure === 'star' ? boom : { data: STARS, error: null }) },
      );
      const settings = new FightBookSettingsService(supabase as never);
      expect(await settings.get(live(true))).toEqual({
        hasProfile: true,
        enabled: true,
        showStars: true,
        dailyLimit: null,
        sparred: null,
        stars: null,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(step);
      expect(String(warn.mock.calls[0]![0])).not.toContain(MARC);
      warn.mockRestore();
    });
  });

  it('answers a caller with no profile with no read', async () => {
    const { settings, supabase } = service(true);
    expect(await settings.get({ userId: ACCOUNT, globalPersonId: null, enabled: false })).toEqual({
      hasProfile: false,
      enabled: false,
      showStars: false,
      dailyLimit: null,
      sparred: 0,
      stars: null,
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  describe('the daily limit', () => {
    const limitFilters = (supabase: ReturnType<typeof service>['supabase']) =>
      filtersFor(supabase.from, 'fightbook_daily_limits', 'eq');

    it("reads the caller's own limit, never another profile's", async () => {
      const { settings, supabase } = service(true, false, 3);
      expect(await settings.get(live(true))).toMatchObject({ dailyLimit: 3 });
      expect(selectsFor(supabase.from, 'fightbook_daily_limits')).toEqual(['daily_limit']);
      expect(limitFilters(supabase)).toEqual([['global_person_id', MARC]]);
    });

    it('answers null when no row is stored', async () => {
      const { settings } = service(true, false, null);
      expect(await settings.get(live(true))).toMatchObject({ dailyLimit: null });
    });

    it('throws when the limit read fails, as the stars read does', async () => {
      const supabase = mockSupabase({
        global_persons: { data: { fightbook_show_stars: false }, error: null },
        fightbook_daily_limits: { data: null, error: { message: 'boom' } },
      });
      await expect(new FightBookSettingsService(supabase as never).get(live(true))).rejects.toThrow(
        'FightBook daily limit read failed: boom',
      );
    });

    it('upserts the limit on the profile column, and writes nothing to global_persons', async () => {
      const { settings, supabase } = service(true, false, 4);
      expect(await settings.set(live(true), { dailyLimit: 4 })).toMatchObject({
        enabled: true,
        dailyLimit: 4,
      });
      const [write] = writesTo(supabase, 'fightbook_daily_limits');
      expect(write?.op).toBe('upsert');
      expect(write?.row).toEqual({
        global_person_id: MARC,
        daily_limit: 4,
        updated_at: expect.any(String),
      });
      const call = supabase.from.mock.results
        .map((r, i) => ({ r, table: supabase.from.mock.calls[i]![0] }))
        .find(({ table }) => table === 'fightbook_daily_limits')!;
      expect(call.r.value.upsert.mock.calls[0]![1]).toEqual({ onConflict: 'global_person_id' });
      expect(writesTo(supabase, 'global_persons')).toEqual([]);
    });

    it('answers the stored switches on a limit-only save', async () => {
      const { settings, supabase } = service(true, true, 4);
      expect(await settings.set(live(true), { dailyLimit: 4 })).toMatchObject({
        enabled: true,
        showStars: true,
      });
      expect(selectsFor(supabase.from, 'global_persons')).toEqual([
        'fightbook_enabled, fightbook_show_stars',
      ]);
      expect(filtersFor(supabase.from, 'global_persons', 'eq')).toEqual([['id', MARC]]);
    });

    it('deletes the caller’s row on null, and only theirs', async () => {
      const { settings, supabase } = service(true, false, null);
      expect(await settings.set(live(true), { dailyLimit: null })).toMatchObject({
        dailyLimit: null,
      });
      const [write] = writesTo(supabase, 'fightbook_daily_limits');
      expect(write?.op).toBe('delete');
      expect(limitFilters(supabase).slice(0, 1)).toEqual([['global_person_id', MARC]]);
      expect(writesTo(supabase, 'global_persons')).toEqual([]);
    });

    it('a switch-only save touches no limit row and answers the stored limit', async () => {
      const { settings, supabase } = service(true, false, 3);
      expect(await settings.set(live(false), { enabled: true })).toMatchObject({ dailyLimit: 3 });
      expect(writesTo(supabase, 'fightbook_daily_limits')).toEqual([]);
    });

    it.each([
      ['an upsert', 4],
      ['a delete', null],
    ])('a failed limit write throws (%s)', async (_label, dailyLimit) => {
      const supabase = mockSupabase({
        global_persons: {
          data: { fightbook_enabled: true, fightbook_show_stars: false },
          error: null,
        },
        fightbook_daily_limits: { data: null, error: { message: 'boom' } },
      });
      await expect(
        new FightBookSettingsService(supabase as never).set(live(true), { dailyLimit }),
      ).rejects.toThrow('FightBook daily limit write failed: boom');
    });
  });

  it('saves the switch on the caller’s own profile and answers what was saved', async () => {
    const { settings, supabase } = service(true);
    expect(await settings.set(live(false), { enabled: true })).toMatchObject({
      hasProfile: true,
      enabled: true,
      showStars: false,
    });
    const [write] = writesTo(supabase, 'global_persons');
    expect(write?.op).toBe('update');
    expect(write?.row).toEqual({ fightbook_enabled: true });
    expect(filtersFor(supabase.from, 'global_persons', 'eq')).toEqual([['id', MARC]]);
  });

  it('saves the stars switch on the caller’s row only, leaving FightBook as it is', async () => {
    const { settings, supabase } = service(true, true);
    const saved = await settings.set(live(true), { showStars: true });
    expect(saved).toMatchObject({ enabled: true, showStars: true, stars: STARS });
    const [write] = writesTo(supabase, 'global_persons');
    expect(write?.row).toEqual({ fightbook_show_stars: true });
    expect(selectsFor(supabase.from, 'global_persons')).toEqual([
      'fightbook_enabled, fightbook_show_stars',
    ]);
    expect(filtersFor(supabase.from, 'global_persons', 'eq')).toEqual([['id', MARC]]);
    expect(filtersFor(supabase.from, 'global_persons', 'eq')).not.toContainEqual(['id', LEA]);
    expect(writesTo(supabase, 'spar_requests')).toEqual([]);
  });

  it('switching on takes back nothing', async () => {
    const { settings, supabase } = service(true);
    await settings.set(live(false), { enabled: true });
    expect(writesTo(supabase, 'spar_requests')).toEqual([]);
  });

  it("switching off takes back the caller's own requests still open", async () => {
    const { settings, supabase } = service(false);
    await settings.set(live(true), { enabled: false });
    const [withdraw] = writesTo(supabase, 'spar_requests');
    expect(withdraw?.row).toEqual({ status: 'withdrawn' });
    // The first two filters are the withdrawal's; the own-line count after it is a second read.
    expect(filtersFor(supabase.from, 'spar_requests', 'eq').slice(0, 2)).toEqual([
      ['asker_global_person_id', MARC],
      ['status', 'pending'],
    ]);
    // Past its end, a request is already a no: withdrawing it would let its asker ask again.
    expect(filtersFor(supabase.from, 'spar_requests', 'gt')).toEqual([
      ['expires_at', expect.any(String)],
    ]);
  });

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
      await settings.set(live(true), { enabled: false });
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
      await settings.set(live(true), { enabled: false });
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
      await settings.set(live(false), { enabled: true });
      await settings.set(live(true), { showStars: true });
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
      await expect(settings.set(live(true), { enabled: false })).rejects.toThrow(
        `FightBook is off, but ${what}: boom`,
      );
    });
  });

  it('refuses a caller with no profile', async () => {
    const { settings } = service(true);
    await expect(
      settings.set({ userId: ACCOUNT, globalPersonId: null, enabled: false }, { enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
