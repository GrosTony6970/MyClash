import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import { ScoringService } from './scoring.service';
import {
  BOUT,
  hit,
  phase,
  OVER_EVENT,
  setup,
  storedBout,
} from './scoring.service.corrections.fixtures';

/**
 * Ruling 226: a door asks BEFORE it writes, about the sheet as it would read.
 * Red won 5-4; each case below would hand the bout to Blue, or leave it level.
 */
describe('ScoringService.assertCorrectionLands', () => {
  const SHEET_5_4 = [hit(1, 'red', 3), hit(2, 'red', 2), hit(3, 'blue', 2), hit(4, 'blue', 2)];
  const LATER_BOUT_FOUGHT = { ...OVER_EVENT, laterBoutFought: true };
  const refusal = (code: string) =>
    expect.objectContaining({ response: expect.objectContaining({ code }) });

  it('refuses a void that would change who won once a later bout was fought', async () => {
    const { db, service } = setup(storedBout(), SHEET_5_4, LATER_BOUT_FOUGHT);

    const asked = service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e2'] });

    await expect(asked).rejects.toBeInstanceOf(ConflictException);
    await expect(asked).rejects.toEqual(refusal('correction_later_bout_fought'));
    expect(db.writes).toEqual([]);
  });

  it('lets through a void that keeps the winner, later bout or not', async () => {
    // Blue loses 2 points: 5-2, still Red.
    const { db, service } = setup(storedBout(), SHEET_5_4, LATER_BOUT_FOUGHT);

    await expect(
      service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e4'] }),
    ).resolves.toBeUndefined();
    expect(db.writes).toEqual([]);
  });

  it('lets through a void that moves the winner when nothing later was fought', async () => {
    const { db, service } = setup(storedBout(), SHEET_5_4);

    await expect(
      service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e2'] }),
    ).resolves.toBeUndefined();
    // It only asks: the write is the recompute's, after the door's own.
    expect(db.writes).toEqual([]);
  });

  it('refuses a correction that leaves a bracket bout level (ruling 227)', async () => {
    const bracketBout = storedBout({ phases: phase('single_elim'), match_number_label: 'QF1' });
    // Red loses 1 of its 3: 4-4.
    const { service } = setup(bracketBout, [
      hit(1, 'red', 1),
      hit(2, 'red', 2),
      hit(3, 'red', 2),
      hit(4, 'blue', 2),
      hit(5, 'blue', 2),
    ]);

    await expect(service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e1'] })).rejects.toEqual(
      refusal('correction_leaves_bout_level'),
    );
  });

  it('reads the row of an exchange about to be restored, and counts it', async () => {
    // The sheet reads 3-4 for Blue; the voided Red hit would make it 5-4.
    const voided = { ...hit(2, 'red', 2), voided: true };
    const { db, service } = setup(
      storedBout({ winner_registration_id: 'blue', red_score: 3, blue_score: 4 }),
      [hit(1, 'red', 3), voided, hit(3, 'blue', 2), hit(4, 'blue', 2)],
      LATER_BOUT_FOUGHT,
    );

    await expect(
      service.assertCorrectionLands(BOUT, { restoreExchangeIds: ['e2'] }),
    ).rejects.toEqual(refusal('correction_later_bout_fought'));
    expect(selectsFor(db.from, 'exchanges')).toEqual(['*', '*']);
    expect(filtersFor(db.from, 'exchanges', 'in')).toEqual([['id', ['e2']]]);
  });

  it('counts an exchange about to be inserted in place of the one it replaces', async () => {
    // Blue's 2 becomes Blue's 4: 5-6. The dropped row alone leaves Red ahead, 5-2.
    const { service } = setup(storedBout(), SHEET_5_4, LATER_BOUT_FOUGHT);

    await expect(
      service.assertCorrectionLands(BOUT, {
        dropExchangeIds: ['e4'],
        addExchanges: [{ ...hit(5, 'blue', 4), id: undefined }],
      }),
    ).rejects.toEqual(refusal('correction_later_bout_fought'));
  });

  it('counts a card about to be voided', async () => {
    // Red's 5 hits stand at 3 under a 2-point card: 3-4 for Blue. Without it, 5-4.
    const card = { id: 'card-1', match_id: BOUT, score_delta: -2, registration_id: 'red' };
    const { service } = setup(
      storedBout({ winner_registration_id: 'blue', red_score: 3, blue_score: 4 }),
      SHEET_5_4,
      LATER_BOUT_FOUGHT,
      [{ ...card, voided: false, round_number: 1 }],
    );

    await expect(
      service.assertCorrectionLands(BOUT, { dropPenaltyIds: ['card-1'] }),
    ).rejects.toEqual(refusal('correction_later_bout_fought'));
    await expect(
      service.assertCorrectionLands(BOUT, { dropPenaltyIds: ['another-card'] }),
    ).resolves.toBeUndefined();
  });

  it('a bout still being fought has no result to protect: it reads nothing more', async () => {
    const { db, service, matchCompletion } = setup(
      storedBout({ status: 'running' }),
      SHEET_5_4,
      LATER_BOUT_FOUGHT,
    );

    await service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e2'] });

    expect(queriedTables(db.from)).toEqual(['matches']);
    expect(matchCompletion.resultChangeContext).not.toHaveBeenCalled();
  });

  it('a best-of series keeps its closed rounds: nothing to refuse', async () => {
    const series = storedBout({
      phases: {
        type: 'single_elim',
        tournaments: {
          ruleset_config: {
            matchFormat: { pointCap: 7, bestOf: { pool: 1, bracket: 3, finals: 3 } },
          },
          scoring_config_json: null,
        },
      },
      match_number_label: 'QF1',
    });
    const { service, matchCompletion } = setup(series, SHEET_5_4, LATER_BOUT_FOUGHT);

    await service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e2'] });

    expect(matchCompletion.resultChangeContext).not.toHaveBeenCalled();
  });

  it('a context that cannot be read fails the question: nothing is written yet', async () => {
    const { service, matchCompletion } = setup(storedBout(), SHEET_5_4);
    matchCompletion.resultChangeContext.mockRejectedValueOnce(new Error('read failed'));

    await expect(service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e2'] })).rejects.toThrow(
      'read failed',
    );
  });

  it('a failed read of the exchange to restore is not "no exchange"', async () => {
    const db = mockSupabase({
      matches: { rows: [storedBout()] },
      exchanges: [
        { data: SHEET_5_4, error: null },
        { data: null, error: { message: 'connection reset' } },
      ],
      match_penalties: { rows: [] },
    });
    const service = new ScoringService(
      db as never,
      { resolve: vi.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.assertCorrectionLands(BOUT, { restoreExchangeIds: ['e2'] }),
    ).rejects.toThrow('Could not read the exchanges to restore: connection reset');
  });
});
