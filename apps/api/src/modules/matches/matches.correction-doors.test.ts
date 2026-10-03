import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * Ruling 226: a correction lands whole or not at all. There is no transaction,
 * so each door asks the scorer BEFORE its first write, and says what it is
 * about to do to the sheet. What the scorer answers is
 * `scoring.service.corrections.test.ts`; what is pinned here is the question,
 * its place before the write, and that a refusal leaves nothing behind.
 */
const REFUSAL = new ConflictException({ code: 'correction_later_bout_fought' });

function setup(exchange: Record<string, unknown>, guard?: Record<string, unknown>) {
  const db = mockSupabase({
    exchanges: {
      rows: [{ id: 'ex-1', match_id: 'm1', sequence: 3, round_number: 2, ...exchange }],
      returning: { id: 'ex-2' },
    },
    matches: { rows: [{ id: 'm1', locked_at: null }] },
    audit_log: { rows: [] },
  });
  const askedWithWrites: number[] = [];
  const scoring = {
    recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
    assertCorrectionLands: vi.fn(async (_matchId: string, _change: unknown) => {
      askedWithWrites.push(db.writes.length);
    }),
  };
  const service = new MatchesService(
    db as never,
    scoring as never,
    {} as never,
    {} as never,
    {} as never,
    guard as never,
  );
  return { db, scoring, service, askedWithWrites };
}

const EDIT = {
  type: 'clean',
  firstStrikerColor: 'blue',
  firstStrikeValue: 2,
  reason: 'wrong side',
};

describe('the correction doors ask before they write', () => {
  it('a void says which exchange goes', async () => {
    const { db, scoring, service, askedWithWrites } = setup({ voided: false });

    await service.voidExchange('ex-1', { reason: 'wrong side' });

    expect(scoring.assertCorrectionLands).toHaveBeenCalledWith('m1', {
      dropExchangeIds: ['ex-1'],
    });
    expect(askedWithWrites).toEqual([0]);
    expect(writesTo(db, 'exchanges')).toHaveLength(1);
  });

  it('a restored void says which exchange comes back', async () => {
    const { db, scoring, service, askedWithWrites } = setup({ voided: true });

    await service.revertVoidExchange('ex-1');

    expect(scoring.assertCorrectionLands).toHaveBeenCalledWith('m1', {
      restoreExchangeIds: ['ex-1'],
    });
    expect(askedWithWrites).toEqual([0]);
    expect(writesTo(db, 'exchanges')).toHaveLength(1);
  });

  it('an edit says which exchange goes and hands over the row that replaces it', async () => {
    const { db, scoring, service, askedWithWrites } = setup({ voided: false });

    await service.editExchange('ex-1', EDIT as never);

    const [matchId, change] = scoring.assertCorrectionLands.mock.calls[0] ?? [];
    const asked = change as { dropExchangeIds: string[]; addExchanges: unknown[] };
    expect(matchId).toBe('m1');
    expect(asked.dropExchangeIds).toEqual(['ex-1']);
    expect(asked.addExchanges).toEqual([
      expect.objectContaining({
        match_id: 'm1',
        round_number: 2,
        type: 'clean',
        first_striker_color: 'blue',
        first_strike_value: 2,
        blue_score_delta: 2,
        corrected_exchange_id: 'ex-1',
        voided: false,
      }),
    ]);
    expect(askedWithWrites).toEqual([0]);
    // The row that was asked about is the row that is written.
    const [voided, inserted] = writesTo(db, 'exchanges');
    expect(voided?.row).toMatchObject({ voided: true });
    expect(inserted?.row).toEqual(asked.addExchanges[0]);
  });

  it.each<[string, (service: MatchesService) => Promise<unknown>, boolean]>([
    ['void', (service) => service.voidExchange('ex-1', { reason: 'wrong side' }), false],
    ['restored void', (service) => service.revertVoidExchange('ex-1'), true],
    ['edit', (service) => service.editExchange('ex-1', EDIT as never), false],
  ])('a refused %s leaves nothing behind', async (_door, act, voided) => {
    const { db, scoring, service } = setup({ voided });
    scoring.assertCorrectionLands.mockRejectedValueOnce(REFUSAL);

    await expect(act(service)).rejects.toBe(REFUSAL);

    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  it('a void that only files a request for review asks nothing yet', async () => {
    const pending = { pendingReview: true, requestId: 'request-1', status: 'pending' };
    const { scoring, service } = setup(
      { voided: false },
      { guardExchangeMutation: vi.fn().mockResolvedValue(pending) },
    );

    expect(await service.voidExchange('ex-1', { reason: 'wrong side' }, { userId: 'u1' })).toEqual(
      pending,
    );
    expect(scoring.assertCorrectionLands).not.toHaveBeenCalled();
  });

  it('the approval of that request asks then, and a refusal reaches the approver', async () => {
    const { db, scoring, service } = setup({ voided: false }, { guardExchangeMutation: vi.fn() });
    scoring.assertCorrectionLands.mockRejectedValueOnce(REFUSAL);

    await expect(
      service.approveFrozenExchangeEdit(
        { id: 'request-1', exchange_id: 'ex-1', request_type: 'void_exchange', reason: 'wrong' },
        'platform-admin-1',
      ),
    ).rejects.toBe(REFUSAL);
    expect(db.writes).toEqual([]);
  });
});
