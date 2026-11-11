import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { FightBookSettingsService } from './fightbook-settings.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const live = (enabled: boolean) => ({ userId: ACCOUNT, globalPersonId: MARC, enabled });

function service(saved: boolean) {
  const supabase = mockSupabase({
    global_persons: { data: { fightbook_enabled: saved }, error: null },
    spar_requests: { data: [], error: null },
  });
  return { settings: new FightBookSettingsService(supabase as never), supabase };
}

describe('FightBookSettingsService', () => {
  it('answers the caller’s switch and whether they have a profile, with no read', () => {
    const { settings, supabase } = service(true);
    expect(settings.get(live(true))).toEqual({ hasProfile: true, enabled: true });
    expect(settings.get({ userId: ACCOUNT, globalPersonId: null, enabled: false })).toEqual({
      hasProfile: false,
      enabled: false,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('saves the switch on the caller’s own profile and answers what was saved', async () => {
    const { settings, supabase } = service(true);
    expect(await settings.set(live(false), true)).toEqual({ hasProfile: true, enabled: true });
    const [write] = writesTo(supabase, 'global_persons');
    expect(write?.op).toBe('update');
    expect(write?.row).toEqual({ fightbook_enabled: true });
    expect(filtersFor(supabase.from, 'global_persons', 'eq')).toEqual([['id', MARC]]);
  });

  it('switching on takes back nothing', async () => {
    const { settings, supabase } = service(true);
    await settings.set(live(false), true);
    expect(writesTo(supabase, 'spar_requests')).toEqual([]);
  });

  it("switching off takes back the caller's own requests still open", async () => {
    const { settings, supabase } = service(false);
    await settings.set(live(true), false);
    const [withdraw] = writesTo(supabase, 'spar_requests');
    expect(withdraw?.row).toEqual({ status: 'withdrawn' });
    expect(filtersFor(supabase.from, 'spar_requests', 'eq')).toEqual([
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
      settings.set({ userId: ACCOUNT, globalPersonId: null, enabled: false }, true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
