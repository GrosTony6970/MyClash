import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { MARC, PAUL, SPAR, callRow, world } from './open-calls.fixtures';
import { scheduleSparReminders } from './spar-reminder';
import { SparRequestsService } from './spar-requests.service';

// A reminder that never settles: the answer must not wait for it.
vi.mock('./spar-reminder', () => ({
  scheduleSparReminders: vi.fn(() => new Promise<void>(() => undefined)),
}));

const REQUEST = '5b000000-0000-4000-8000-00000000000a';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';

function answering(status: 'agreed' | 'not_this_time') {
  const supabase = mockSupabase(
    { global_persons: { rows: [{ id: MARC, claimed_by_user_id: 'acc-m' }] } },
    { fightbook_answer: () => ({ data: { asker: MARC, status }, error: null }) },
  );
  Object.assign(supabase, {
    getAuthAdminUser: vi.fn(async () => ({ ok: true, status: 200, data: { email: null } })),
  });
  return new SparRequestsService(supabase as never, { sendImmediate: vi.fn() } as never);
}

describe('who starts the reminder', () => {
  it('a Yes starts it for the spar, and the answer does not wait for it', async () => {
    vi.mocked(scheduleSparReminders).mockClear();
    const answer = await answering('agreed').answer(JULIE, REQUEST, { answer: 'yes' });
    expect(answer).toEqual({ status: 'agreed' });
    expect(scheduleSparReminders).toHaveBeenCalledTimes(1);
    expect(vi.mocked(scheduleSparReminders).mock.calls[0]?.[1]).toBe(REQUEST);
  });

  it('a "Not this time" never starts it', async () => {
    vi.mocked(scheduleSparReminders).mockClear();
    await answering('not_this_time').answer(JULIE, REQUEST, { answer: 'no' });
    expect(scheduleSparReminders).not.toHaveBeenCalled();
  });

  it('a pick starts it with the new spar id', async () => {
    vi.mocked(scheduleSparReminders).mockClear();
    const { open } = world({ calls: [callRow({ poster_global_person_id: MARC })] });
    await open.pick(MARC, callRow().id as string, PAUL);
    expect(scheduleSparReminders).toHaveBeenCalledTimes(1);
    expect(vi.mocked(scheduleSparReminders).mock.calls[0]?.[1]).toBe(SPAR);
  });
});
