import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { assertRefereeBoardUnlocked, isRefereeBoardLocked } from './referee-lock';

const row = (over: Record<string, unknown>) => ({
  id: 'ra-1',
  event_id: 'event-1',
  status: 'confirmed',
  scope_type: 'pool',
  ...over,
});

describe('the referee lock (ADR-019)', () => {
  it('is locked by a confirmed Pool row of the Event', async () => {
    const db = mockSupabase({ referee_assignments: { rows: [row({})] } });
    await expect(isRefereeBoardLocked(db.service as never, 'event-1')).resolves.toBe(true);
    expect(selectsFor(db.from, 'referee_assignments')).toEqual(['id']);
  });

  it('is locked by a confirmed bout row', async () => {
    const db = mockSupabase({ referee_assignments: { rows: [row({ scope_type: 'match' })] } });
    await expect(isRefereeBoardLocked(db.service as never, 'event-1')).resolves.toBe(true);
  });

  it.each([
    ['an assigned row', row({ status: 'assigned' })],
    ["another Event's confirmed row", row({ event_id: 'event-2' })],
    ['a confirmed piste row (not a scope the board reads)', row({ scope_type: 'lice' })],
  ])('is not locked by %s', async (_label, only) => {
    const db = mockSupabase({ referee_assignments: { rows: [only] } });
    await expect(isRefereeBoardLocked(db.service as never, 'event-1')).resolves.toBe(false);
  });

  it('refuses 409 referee_board_locked while locked', async () => {
    const db = mockSupabase({ referee_assignments: { rows: [row({})] } });
    const refusal = await assertRefereeBoardUnlocked(db.service as never, 'event-1').catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toEqual({
      code: 'referee_board_locked',
      message: 'Referee assignments are locked. Unlock them before changing a referee.',
    });
  });

  it('a failed read is a plain Error (a 5xx), never "unlocked"', async () => {
    const db = mockSupabase({
      referee_assignments: { data: null, error: { message: 'connection reset' } },
    });
    const failure = isRefereeBoardLocked(db.service as never, 'event-1');
    await expect(failure).rejects.toThrow('Could not read the referee lock: connection reset');
    await expect(failure).rejects.not.toHaveProperty('status');
  });
});
