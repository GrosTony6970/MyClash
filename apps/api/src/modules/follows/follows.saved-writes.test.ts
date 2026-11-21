/**
 * A failed decorative read after a saved write does not fail the write (operator ruling 122).
 *
 * A follow write used to read its person's next bout AFTER the write, and a failed read answered
 * 5xx, so the page rolled back a follow the server had saved. No screen read that next bout, so it
 * is gone: a follow write now answers its saved row, and only a failed write is a 5xx.
 */
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
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
  event_id: EVENT,
  created_at: '2026-09-25T00:00:00Z',
  notify_match_start: true,
  notify_workshop_start: false,
  persons: { given_name: 'Léa', family_name: 'Martin', clubs: { name: 'Salle' } },
};

function build(tables: Record<string, TableSeed>) {
  // A roster row with no profile: a new follow asks for it, and starts as a first follow.
  const supabase = mockSupabase({ persons: { data: null, error: null }, ...tables });
  const service = new FollowsService(
    supabase as never,
    {
      forPerson: vi.fn().mockResolvedValue({ allowBeingFollowed: true }),
      forGlobalPerson: vi.fn().mockResolvedValue({ allowBeingFollowed: true }),
    } as never,
    { applyFollow: vi.fn() } as never,
    {} as never,
  );
  return { service, supabase };
}

afterEach(() => vi.restoreAllMocks());

describe('a saved follow write answers its row (ruling 122)', () => {
  it('a new follow answers its row, and reads no next bout', async () => {
    // No follow yet, then the inserted row read back.
    const { service, supabase } = build({
      follows: [
        { data: null, error: null },
        { data: ROW, error: null },
      ],
      registrations: FAILED,
    });
    const row = await service.follow(EVENT, PERSON, FAN);
    expect(row).toMatchObject({ id: 'f1', personName: 'Léa Martin' });
    expect(row).not.toHaveProperty('nextEvent');
    expect(writesTo(supabase, 'follows')).toHaveLength(1);
    expect(queriedTables(supabase.from)).not.toContain('registrations');
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
});
