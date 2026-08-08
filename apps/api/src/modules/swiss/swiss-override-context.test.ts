import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import type { SwissPairingService } from './swiss-pairing.service';
import { loadEditableRoundData } from './swiss-override-context';

const as = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

type PriorRound = {
  id: string;
  byeRegistrationId: string | null;
  matches: Array<{ redRegistrationId: string | null; blueRegistrationId: string | null }>;
};

const pairingStub = (rounds: PriorRound[]) =>
  ({ loadRounds: vi.fn().mockResolvedValue(rounds) }) as unknown as SwissPairingService;

const roundRow = (over: Record<string, unknown> = {}) => ({
  data: {
    id: 'round-2',
    phase_id: 'phase-1',
    round_number: 2,
    status: 'in_progress',
    bye_registration_id: null,
    pairing_meta_json: null,
    matches: [],
    ...over,
  },
  error: null,
});

describe('loadEditableRoundData', () => {
  it('throws BadRequest when the round read errors', async () => {
    const supabase = mockSupabase({
      swiss_rounds: { data: null, error: { message: 'round read failed' } },
    });
    await expect(loadEditableRoundData(as(supabase), pairingStub([]), 'round-2')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFound when the round does not exist', async () => {
    const supabase = mockSupabase({ swiss_rounds: { data: null, error: null } });
    await expect(loadEditableRoundData(as(supabase), pairingStub([]), 'ghost')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('maps the round row onto the editable shape', async () => {
    const supabase = mockSupabase({
      swiss_rounds: roundRow({
        bye_registration_id: 'r9',
        pairing_meta_json: { method: 'fold' },
        matches: [
          { id: 'm1', status: 'scheduled', red_registration_id: 'r1', blue_registration_id: 'r2' },
        ],
      }),
      swiss_entrants: { data: [], error: null },
    });
    const round = await loadEditableRoundData(as(supabase), pairingStub([]), 'round-2');

    expect(round).toMatchObject({
      id: 'round-2',
      phaseId: 'phase-1',
      roundNumber: 2,
      status: 'in_progress',
      byeRegistrationId: 'r9',
      pairingMeta: { method: 'fold' },
    });
    expect(round.matches).toHaveLength(1);
  });

  it('defaults a missing matches embed to an empty array', async () => {
    const supabase = mockSupabase({
      swiss_rounds: roundRow({ matches: undefined }),
      swiss_entrants: { data: [], error: null },
    });
    const round = await loadEditableRoundData(as(supabase), pairingStub([]), 'round-2');
    expect(round.matches).toEqual([]);
  });

  it('EXCLUDES the round being edited from prior meetings', async () => {
    // The whole reason this excludes: a swap inside round 2 must not warn that
    // it recreates the pairing it is replacing.
    const supabase = mockSupabase({
      swiss_rounds: roundRow(),
      swiss_entrants: { data: [], error: null },
    });
    const pairing = pairingStub([
      {
        id: 'round-1',
        byeRegistrationId: 'r5',
        matches: [{ redRegistrationId: 'r1', blueRegistrationId: 'r2' }],
      },
      {
        id: 'round-2',
        byeRegistrationId: 'r9',
        matches: [{ redRegistrationId: 'r3', blueRegistrationId: 'r4' }],
      },
    ]);

    const round = await loadEditableRoundData(as(supabase), pairing, 'round-2');
    expect(round.priorOpponents.get('r1')).toEqual(new Set(['r2']));
    expect(round.priorOpponents.get('r2')).toEqual(new Set(['r1']));
    // From round 2 — excluded.
    expect(round.priorOpponents.has('r3')).toBe(false);
    expect(round.priorByes).toEqual(new Set(['r5']));
    expect(round.priorByes.has('r9')).toBe(false);
  });

  it('accumulates opponents across several prior rounds, both directions', async () => {
    const supabase = mockSupabase({
      swiss_rounds: roundRow(),
      swiss_entrants: { data: [], error: null },
    });
    const pairing = pairingStub([
      {
        id: 'round-1',
        byeRegistrationId: null,
        matches: [{ redRegistrationId: 'r1', blueRegistrationId: 'r2' }],
      },
      {
        id: 'round-1b',
        byeRegistrationId: null,
        matches: [{ redRegistrationId: 'r3', blueRegistrationId: 'r1' }],
      },
    ]);
    const round = await loadEditableRoundData(as(supabase), pairing, 'round-2');
    expect(round.priorOpponents.get('r1')).toEqual(new Set(['r2', 'r3']));
    expect(round.priorOpponents.get('r3')).toEqual(new Set(['r1']));
  });

  it('skips half-empty pairings when building prior opponents', async () => {
    const supabase = mockSupabase({
      swiss_rounds: roundRow(),
      swiss_entrants: { data: [], error: null },
    });
    const pairing = pairingStub([
      {
        id: 'round-1',
        byeRegistrationId: null,
        matches: [
          { redRegistrationId: 'r1', blueRegistrationId: null },
          { redRegistrationId: null, blueRegistrationId: 'r2' },
        ],
      },
    ]);
    const round = await loadEditableRoundData(as(supabase), pairing, 'round-2');
    expect(round.priorOpponents.size).toBe(0);
  });

  it('maps clubs, skipping entrants with no club', async () => {
    const supabase = mockSupabase({
      swiss_rounds: roundRow(),
      swiss_entrants: {
        data: [
          { registration_id: 'r1', registrations: { persons: { club_id: 'club-a' } } },
          { registration_id: 'r2', registrations: { persons: { club_id: null } } },
          { registration_id: 'r3', registrations: { persons: {} } },
          { registration_id: 'r4', registrations: null },
        ],
        error: null,
      },
    });
    const round = await loadEditableRoundData(as(supabase), pairingStub([]), 'round-2');
    expect(round.clubByRegistration).toEqual(new Map([['r1', 'club-a']]));
  });

  it('tolerates a null entrants result', async () => {
    const supabase = mockSupabase({
      swiss_rounds: roundRow(),
      swiss_entrants: { data: null, error: null },
    });
    const round = await loadEditableRoundData(as(supabase), pairingStub([]), 'round-2');
    expect(round.clubByRegistration.size).toBe(0);
  });
});
