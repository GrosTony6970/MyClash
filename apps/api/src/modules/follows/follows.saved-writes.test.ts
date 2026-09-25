/**
 * A failed decorative read after a saved write does not fail the write (operator ruling 122).
 *
 * A follow, a notification toggle and an "add to group" each read decoration AFTER their write
 * (the next bout; a card's stats). A failed read there answered 5xx, so the page rolled back a
 * change the server had saved. The write now answers without the decoration and the failure goes
 * to the log. The lists stay strict: a failed read of follows is a 5xx (ruling 117a).
 */
import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  writesTo,
  type ChainResult,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FollowsService } from './follows.service';

const EVENT = 'e1';
const PERSON = 'p1';
const FAN = { userId: 'fan-user' };
const FAILED: ChainResult = { data: null, error: { message: 'boom' } };
const ROW = {
  id: 'f1',
  followed_person_id: PERSON,
  created_at: '2026-09-25T00:00:00Z',
  notify_match_start: true,
  notify_workshop_start: false,
  persons: { given_name: 'Léa', family_name: 'Martin', clubs: { name: 'Salle' } },
};

function build(tables: Record<string, TableSeed>) {
  const supabase = mockSupabase(tables);
  const service = new FollowsService(
    supabase as never,
    { getOrCreate: vi.fn().mockResolvedValue({ allowBeingFollowed: true }) } as never,
    { cancelForFollowedPerson: vi.fn() } as never,
    {} as never,
  );
  return { service, supabase };
}

const warnings = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

afterEach(() => vi.restoreAllMocks());

describe('a saved follow write survives a failed next-bout read (ruling 122)', () => {
  it('a new follow answers without its next bout, and says so in the log', async () => {
    const warn = warnings();
    // No follow yet, then the inserted row read back.
    const { service, supabase } = build({
      follows: [
        { data: null, error: null },
        { data: ROW, error: null },
      ],
      registrations: FAILED,
    });
    const row = await service.follow(EVENT, PERSON, FAN);
    expect(row).toMatchObject({ id: 'f1', personName: 'Léa Martin', nextEvent: null });
    expect(writesTo(supabase, 'follows')).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('registrations read failed: boom'));
  });

  it("two follows racing: the loser answers the winner's row, not a failure", async () => {
    const { service } = build({
      follows: [
        { data: null, error: null }, // the check: no follow yet
        { data: null, error: { code: '23505', message: 'duplicate key value' } }, // lost the race
        { data: ROW, error: null }, // the winner's row
      ],
      registrations: { rows: [] },
    });
    await expect(service.follow(EVENT, PERSON, FAN)).resolves.toMatchObject({ id: 'f1' });
  });

  it('a follow write that fails for another reason is still a 5xx', async () => {
    const { service } = build({
      follows: [{ data: null, error: null }, FAILED],
      registrations: { rows: [] },
    });
    const run = service.follow(EVENT, PERSON, FAN);
    await expect(run).rejects.toThrow('follow write failed: boom');
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
  });

  it('a follow that already exists answers the same way', async () => {
    warnings();
    const { service } = build({ follows: { data: ROW, error: null }, registrations: FAILED });
    await expect(service.follow(EVENT, PERSON, FAN)).resolves.toMatchObject({ nextEvent: null });
  });

  it('a saved notification toggle answers without its next bout', async () => {
    const warn = warnings();
    const { service, supabase } = build({
      follows: { data: ROW, error: null },
      registrations: FAILED,
    });
    const row = await service.updateNotifications(EVENT, PERSON, FAN, { notifyMatchStart: false });
    expect(row).toMatchObject({ id: 'f1', nextEvent: null });
    expect(writesTo(supabase, 'follows')).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('a toggle on a follow that is gone is a 404, not a 5xx', async () => {
    // A seeded table, so the terminal matters: `.single()` on no row is PGRST116 (a 5xx).
    const { service } = build({ follows: { rows: [] } });
    const run = service.updateNotifications(EVENT, PERSON, FAN, { notifyMatchStart: false });
    await expect(run).rejects.toBeInstanceOf(NotFoundException);
    await expect(run).rejects.toThrow('Follow not found');
  });

  it('a failed toggle WRITE is still a 5xx', async () => {
    const { service } = build({ follows: FAILED });
    const run = service.updateNotifications(EVENT, PERSON, FAN, { notifyMatchStart: false });
    await expect(run).rejects.toThrow('follow notifications write failed: boom');
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
  });

  it('a list read stays strict: its failed next bout is a 5xx (ruling 117a)', async () => {
    const warn = warnings();
    const { service } = build({ follows: { data: [ROW], error: null }, registrations: FAILED });
    await expect(service.listFollows(EVENT, FAN)).rejects.toThrow('registrations read failed');
    expect(warn).not.toHaveBeenCalled();
  });
});
