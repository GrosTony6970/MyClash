/**
 * A refused exchange correction tells the scorer who asked for it (ruling 202 for its wording).
 * Marc asks to correct an exchange of a frozen Match and Claire refuses, with a reason. The title
 * comes in French and in English; the body is Claire's own reason, as she wrote it.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard, type ExchangeEditRequestRow } from './frozen-results.guard';

const REQUEST = { id: 'r-1', requested_by_user_id: 'u-marc' } as ExchangeEditRequestRow;

describe('a refused exchange correction', () => {
  it('tells the scorer who asked, with the reason as the organiser wrote it', async () => {
    const db = mockSupabase({
      exchange_edit_requests: { rows: [{ id: 'r-1', status: 'pending' }] },
      audit_log: { data: null, error: null },
    });
    const notifications = { sendImmediate: vi.fn() };
    const guard = new FrozenResultsGuard(db as never, notifications as never);

    await guard.markRejected(REQUEST, 'u-claire', '  The hit was to the arm.  ');

    expect(notifications.sendImmediate.mock.calls).toEqual([
      [
        {
          kind: 'exchange_edit_rejected',
          entityId: 'r-1',
          userId: 'u-marc',
          title: 'Demande de correction refusée / Exchange correction rejected',
          body: 'The hit was to the arm.',
          url: '/notifications',
          preference: 'schedule_changes',
        },
      ],
    ]);
  });
});
