import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import {
  CLUBBED_ENTRANTS,
  ROUND_1,
  asSupabase as as,
  editableBout as bout,
  clubbed,
  overrideState as state,
  phaseRow,
  round2,
  swissConfig,
  wroteTo,
} from './swiss.fixtures';
import { SwissOverrideService } from './swiss-override.service';
import { SwissPairingService } from './swiss-pairing.service';

const build = (over: Record<string, unknown> = {}) => {
  const supabase = mockSupabase(state(over));
  const pairing = new SwissPairingService(as(supabase));
  return { supabase, service: new SwissOverrideService(as(supabase), pairing) };
};

describe('SwissOverrideService — swapping two fighters', () => {
  it('exchanges two fighters who sit in different bouts', async () => {
    const { supabase, service } = build();

    await service.swapPairing('sr2', 'r2', 'r3', 'user-1');

    // r2 leaves m1's blue side and r3 leaves m2's red side; each takes the
    // other's place, and no other bout is touched.
    expect(wroteTo(supabase, 'matches')).toEqual([
      { id: 'm1', row: { blue_registration_id: 'r3' } },
      { id: 'm2', row: { red_registration_id: 'r2' } },
    ]);
  });

  it('moves the bye by swapping the fighter who holds it', async () => {
    // "Give the bye to someone else" is not a separate operation — it is a
    // swap where one of the two positions is the bye.
    const { supabase, service } = build({
      swiss_rounds: {
        rows: [ROUND_1, round2({ bye_registration_id: 'r4', matches: [bout('m1', 'r1', 'r2')] })],
      },
      matches: { rows: [bout('m1', 'r1', 'r2')] },
    });

    await service.swapPairing('sr2', 'r1', 'r4', 'user-1');

    expect(wroteTo(supabase, 'matches')).toEqual([
      { id: 'm1', row: { red_registration_id: 'r4' } },
    ]);
    expect(wroteTo(supabase, 'swiss_rounds')[0]).toEqual({
      id: 'sr2',
      row: { bye_registration_id: 'r1' },
    });
  });

  it('fails loud when the write matches no row', async () => {
    // A production trace showed manual-assign PATCHes answering 200 with
    // nothing persisted, because the Supabase result was never inspected. An
    // update whose WHERE matched nothing is a 404, not a success — so the
    // round below names a bout the matches table does not have.
    const { service } = build({
      swiss_rounds: {
        rows: [ROUND_1, round2({ matches: [bout('m9', 'r1', 'r2'), bout('m2', 'r3', 'r4')] })],
      },
    });

    await expect(service.swapPairing('sr2', 'r2', 'r3', 'user-1')).rejects.toThrow(
      /Match m9 not found/,
    );
  });

  it('leaves the round valid, which is the whole point of a swap', async () => {
    const { service } = build();

    const { validation } = await service.swapPairing('sr2', 'r2', 'r3', 'user-1');

    expect(validation).toMatchObject({ valid: true, duplicated: [], missing: [], unknown: [] });
  });

  it('refuses to swap a fighter with themselves', async () => {
    const { service } = build();

    await expect(service.swapPairing('sr2', 'r1', 'r1', 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a fighter who is not in the round', async () => {
    const { service } = build();

    await expect(service.swapPairing('sr2', 'r1', 'r9', 'user-1')).rejects.toThrow(
      /Fighter r9 is not in round 2/,
    );
  });
});

describe('SwissOverrideService — warning before a swap the organiser may still want', () => {
  it('warns before recreating a pairing that has already been fought', async () => {
    // r1 met r4 in round 1. Swapping r2 and r4 puts them together again —
    // legitimate if the organiser means it, so it asks rather than refuses.
    const { supabase, service } = build();

    await expect(service.swapPairing('sr2', 'r2', 'r4', 'user-1')).rejects.toMatchObject({
      response: {
        message: 'Swap needs confirmation',
        warnings: [{ code: 'creates-rematch', registrationIds: ['r4', 'r1'] }],
      },
    });
    // And nothing was written on the way to the question.
    expect(writesTo(supabase, 'matches')).toHaveLength(0);
  });

  it('performs that same swap once it is confirmed', async () => {
    const { supabase, service } = build();

    await service.swapPairing('sr2', 'r2', 'r4', 'user-1', true);

    expect(wroteTo(supabase, 'matches')).toEqual([
      { id: 'm1', row: { blue_registration_id: 'r4' } },
      { id: 'm2', row: { blue_registration_id: 'r2' } },
    ]);
  });

  it('warns before putting two fighters from one club together', async () => {
    // The same swap, with r4 moved into r1's club.
    const { service } = build({
      swiss_entrants: {
        rows: [...CLUBBED_ENTRANTS.slice(0, 3), clubbed('r4', 'club-a')],
      },
    });

    await expect(service.swapPairing('sr2', 'r2', 'r4', 'user-1')).rejects.toMatchObject({
      response: {
        warnings: expect.arrayContaining([{ code: 'same-club', registrationIds: ['r4', 'r1'] }]),
      },
    });
  });

  it('warns before giving a fighter a second bye', async () => {
    // r2 sat round 1 out. Handing them the bye again is the organiser's call,
    // but it is the thing a Swiss draw tries hardest to avoid.
    const { service } = build({
      swiss_rounds: {
        rows: [
          { ...ROUND_1, bye_registration_id: 'r2', matches: [] },
          round2({ bye_registration_id: 'r1', matches: [bout('m1', 'r2', 'r3')] }),
        ],
      },
      matches: { rows: [bout('m1', 'r2', 'r3')] },
    });

    await expect(service.swapPairing('sr2', 'r1', 'r2', 'user-1')).rejects.toMatchObject({
      response: {
        warnings: expect.arrayContaining([{ code: 'repeat-bye', registrationIds: ['r2'] }]),
      },
    });
  });

  it('reads clubs from this phase only', async () => {
    // rX shares r1's club but belongs to another phase. Swapping r2 and r4
    // pairs r1 with r4, who is clubless — so the only same-club answer
    // available comes from a row this phase does not own.
    const { service } = build();

    await expect(service.swapPairing('sr2', 'r2', 'r4', 'user-1')).rejects.toMatchObject({
      response: { warnings: [{ code: 'creates-rematch', registrationIds: ['r4', 'r1'] }] },
    });
  });
});

describe('SwissOverrideService — refusing to edit a round that has moved on', () => {
  it('refuses once the round itself has left pending', async () => {
    const { service } = build({
      swiss_rounds: { rows: [ROUND_1, round2({ status: 'active' })] },
    });

    await expect(service.swapPairing('sr2', 'r1', 'r2', 'user-1')).rejects.toThrow(
      /Round 2 has started/,
    );
  });

  it('refuses once any bout of the round is under way', async () => {
    const { service } = build({
      swiss_rounds: {
        rows: [
          ROUND_1,
          round2({ matches: [bout('m1', 'r1', 'r2'), bout('m2', 'r3', 'r4', 'running')] }),
        ],
      },
    });

    await expect(service.swapPairing('sr2', 'r1', 'r2', 'user-1')).rejects.toThrow(
      /has a bout already under way/,
    );
  });

  it('refuses while the phase is finalised', async () => {
    const { service } = build({
      phases: {
        rows: [
          phaseRow({
            config_json: {
              ...swissConfig(),
              finalized: {
                atRound: 2,
                at: '2026-08-18T10:00:00.000Z',
                byUserId: '00000000-0000-4000-8000-000000000001',
              },
            },
          }),
        ],
      },
    });

    await expect(service.swapPairing('sr2', 'r2', 'r3', 'user-1')).rejects.toThrow(/finalised/);
  });

  it('reports a round that does not exist', async () => {
    const { service } = build();

    await expect(service.swapPairing('sr9', 'r1', 'r2', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('SwissOverrideService — writing both sides of one bout', () => {
  it('writes the sides it was given, and only that bout', async () => {
    const { supabase, service } = build();

    await service.setMatchSides('m1', 'r1', 'r4', 'user-1', true);

    expect(wroteTo(supabase, 'matches')).toEqual([
      { id: 'm1', row: { red_registration_id: 'r1', blue_registration_id: 'r4' } },
    ]);
  });

  it('reports a round this escape hatch has already broken', async () => {
    // The reason the validation exists: a set-sides can leave a fighter in two
    // bouts and another in none. The round below is in exactly that state, and
    // saying so is what blocks the next round from being paired off it.
    const { service } = build({
      swiss_rounds: {
        rows: [ROUND_1, round2({ matches: [bout('m1', 'r1', 'r3'), bout('m2', 'r3', 'r4')] })],
      },
    });

    const validation = await service.validate('p1', 'sr2');

    expect(validation).toMatchObject({ valid: false, duplicated: ['r3'], missing: ['r2'] });
  });

  it('refuses to put one fighter on both sides', async () => {
    const { service } = build();

    await expect(service.setMatchSides('m1', 'r1', 'r1', 'user-1')).rejects.toThrow(
      /cannot be on both sides/,
    );
  });

  it('refuses a bout that has already started', async () => {
    const { service } = build({
      matches: { rows: [bout('m1', 'r1', 'r2', 'running'), bout('m2', 'r3', 'r4')] },
    });

    await expect(service.setMatchSides('m1', 'r1', 'r4', 'user-1')).rejects.toThrow(
      /has already started/,
    );
  });

  it('reports a bout that belongs to no Swiss round', async () => {
    const { service } = build({
      matches: { rows: [{ ...bout('m1', 'r1', 'r2'), swiss_round_id: null }] },
    });

    await expect(service.setMatchSides('m1', 'r1', 'r4', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('warns before a side change that recreates a fought pairing', async () => {
    const { service } = build();

    await expect(service.setMatchSides('m1', 'r1', 'r4', 'user-1')).rejects.toMatchObject({
      response: {
        message: 'Side change needs confirmation',
        warnings: expect.arrayContaining([
          { code: 'creates-rematch', registrationIds: ['r1', 'r4'] },
        ]),
      },
    });
  });
});

describe('SwissOverrideService — recording the adjustment', () => {
  it('badges the round and writes one audit entry', async () => {
    // Recorded twice on purpose: the round carries the badge both the admin
    // card and the public view render, and the audit log is the governance
    // record.
    const { supabase, service } = build();

    await service.swapPairing('sr2', 'r2', 'r3', 'user-1');

    const badge = wroteTo(supabase, 'swiss_rounds').at(-1);
    expect(badge?.id).toBe('sr2');
    const adjustments = (badge?.row['pairing_meta_json'] as Record<string, unknown>)[
      'manualAdjustments'
    ] as Array<Record<string, unknown>>;
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      kind: 'swap',
      aRegistrationId: 'r2',
      bRegistrationId: 'r3',
      byUserId: 'user-1',
    });

    expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
      actor_user_id: 'user-1',
      action: 'swiss.pairing_swap',
      entity_type: 'swiss_round',
      entity_id: 'sr2',
    });
  });

  it('keeps the adjustments a round already carries', async () => {
    const { supabase, service } = build({
      swiss_rounds: {
        rows: [
          ROUND_1,
          round2({ pairing_meta_json: { manualAdjustments: [{ kind: 'set-sides' }] } }),
        ],
      },
    });

    await service.swapPairing('sr2', 'r2', 'r3', 'user-1');

    const badge = wroteTo(supabase, 'swiss_rounds').at(-1);
    const adjustments = (badge?.row['pairing_meta_json'] as Record<string, unknown>)[
      'manualAdjustments'
    ] as unknown[];
    expect(adjustments).toHaveLength(2);
  });

  it('names the set-sides action separately in the audit log', async () => {
    const { supabase, service } = build();

    await service.setMatchSides('m1', 'r1', 'r4', 'user-1', true);

    expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
      action: 'swiss.pairing_set_sides',
    });
  });
});
