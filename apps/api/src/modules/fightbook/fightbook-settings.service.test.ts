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

function service(saved: boolean, showStars = false) {
  const supabase = mockSupabase(
    {
      global_persons: {
        data: { fightbook_enabled: saved, fightbook_show_stars: showStars },
        error: null,
      },
      spar_requests: { data: [], error: null, count: 3 },
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
});

describe('FightBookSettingsService', () => {
  it('answers the switches and the caller’s own line, stars shown whatever the switch', async () => {
    const { settings, supabase } = service(true, false);
    expect(await settings.get(live(true))).toEqual({
      hasProfile: true,
      enabled: true,
      showStars: false,
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
          spar_requests: failure === 'count' ? boom : { data: [], error: null, count: 3 },
        },
        { fightbook_star_line: () => (failure === 'star' ? boom : { data: STARS, error: null }) },
      );
      const settings = new FightBookSettingsService(supabase as never);
      expect(await settings.get(live(true))).toEqual({
        hasProfile: true,
        enabled: true,
        showStars: true,
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
      sparred: 0,
      stars: null,
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
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

  it('refuses a caller with no profile', async () => {
    const { settings } = service(true);
    await expect(
      settings.set({ userId: ACCOUNT, globalPersonId: null, enabled: false }, { enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
