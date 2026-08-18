import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import {
  adminState as state,
  asSupabase as as,
  namedEntrant,
  registration,
  viewBout,
} from './swiss.fixtures';
import { SwissAdminViewService } from './swiss-admin-view.service';
import { SwissPairingService } from './swiss-pairing.service';
import { SwissSeedingService } from './swiss-seeding.service';

const build = (over: Record<string, unknown> = {}) => {
  const supabase = mockSupabase(state(over));
  const pairing = new SwissPairingService(as(supabase));
  const seeding = new SwissSeedingService(as(supabase));
  return { supabase, service: new SwissAdminViewService(as(supabase), pairing, seeding) };
};

describe('SwissAdminViewService — the field the Configure tab reports', () => {
  it('counts only the fighters a phase would be generated from', async () => {
    // Another tournament's fighter and one who withdrew from this one are both
    // in the table. The count has to match the field the seeder would take.
    const { service } = build();

    const view = await service.getAdminView('t1');

    expect(view.registeredCount).toBe(4);
  });

  it('recommends a round count for the entrants, not the registrations', async () => {
    // Sixteen people are registered but only four entered the phase. Once a
    // phase exists the recommendation follows ITS field, so a Configure tab
    // opened on a live phase compares roundCount against the same number that
    // was proposed at generation. Sixteen would recommend four rounds; the
    // four entrants recommend the floor of three.
    const { service } = build({
      registrations: { rows: Array.from({ length: 16 }, (_, i) => registration(`reg${i + 1}`)) },
    });

    const view = await service.getAdminView('t1');

    expect(view.registeredCount).toBe(16);
    expect(view.recommendedRoundCount).toBe(3);
  });

  it('answers for a tournament that has no Swiss phase yet', async () => {
    // The case the Configure tab opens in: no phase, but the field is known,
    // so a round count can already be proposed.
    const { service } = build({
      phases: { rows: [{ id: 'p-pool', type: 'pool', tournament_id: 't1', config_json: null }] },
      registrations: { rows: Array.from({ length: 16 }, (_, i) => registration(`reg${i + 1}`)) },
    });

    const view = await service.getAdminView('t1');

    // With no phase to read a field from, the recommendation follows the
    // registration count: sixteen fighters is four rounds.
    expect(view).toMatchObject({
      phaseId: null,
      config: null,
      registeredCount: 16,
      recommendedRoundCount: 4,
      entrants: [],
      rounds: [],
    });
  });

  it('finds this tournament’s Swiss phase and not its pool one', async () => {
    const { service } = build();

    const view = await service.getAdminView('t1');

    expect(view.phaseId).toBe('p1');
    expect(view.config).toMatchObject({ roundCount: 5, pairingMethod: 'fold' });
  });

  it('reports how much of the field HEMA Ratings knows', async () => {
    // No ratings service is wired here, so nobody resolves as rated. Zero per
    // cent is the honest answer, and it is the number the by-rating refusal
    // quotes back at the organiser.
    const { service } = build();

    const view = await service.getAdminView('t1');

    expect(view.ratingCoverage).toEqual({ rated: 0, total: 4, percent: 0 });
  });

  it('still answers when the ratings lookup fails', async () => {
    // A ratings outage must not take the whole Configure tab down: every other
    // field on this payload is still answerable.
    const { service } = build();
    vi.spyOn(SwissSeedingService.prototype, 'ratingsFor').mockRejectedValueOnce(
      new Error('ratings are down'),
    );

    const view = await service.getAdminView('t1');

    expect(view.ratingCoverage).toBeNull();
    expect(view.registeredCount).toBe(4);
    expect(view.phaseId).toBe('p1');
  });
});

describe('SwissAdminViewService — the entrants', () => {
  it('names the entrants of this phase, and only this phase', async () => {
    // The club falls back to the full name when a club has no abbreviation,
    // and stays null when there is no club at all.
    const { service } = build();

    const view = await service.getAdminView('t1');

    expect(view.entrants).toEqual([
      {
        registrationId: 'r1',
        personName: 'Ada Lovelace',
        clubLabel: 'CLA',
        withdrawnAtRound: null,
      },
      {
        registrationId: 'r2',
        personName: 'Grace Hopper',
        clubLabel: 'Club B',
        withdrawnAtRound: null,
      },
      { registrationId: 'r3', personName: 'Alan Turing', clubLabel: null, withdrawnAtRound: null },
      {
        registrationId: 'r4',
        personName: 'Edsger Dijkstra',
        clubLabel: null,
        withdrawnAtRound: null,
      },
    ]);
  });

  it('keeps an entrant the name lookup cannot answer for', async () => {
    // An entrant with no person embed still belongs to the field. Dropping
    // them would make the Configure tab disagree with the draw.
    const { service } = build({
      swiss_entrants: {
        rows: [
          namedEntrant('r1', 'Ada', 'Lovelace'),
          { phase_id: 'p1', registration_id: 'r9', withdrawn_at_round: null },
        ],
      },
    });

    const view = await service.getAdminView('t1');

    expect(view.entrants).toContainEqual({
      registrationId: 'r9',
      personName: '',
      clubLabel: null,
      withdrawnAtRound: null,
    });
  });

  it('carries the round a fighter withdrew at', async () => {
    const { service } = build({
      swiss_entrants: {
        rows: [{ ...namedEntrant('r1', 'Ada', 'Lovelace'), withdrawn_at_round: 3 }],
      },
    });

    const view = await service.getAdminView('t1');

    expect(view.entrants[0]?.withdrawnAtRound).toBe(3);
  });
});

describe('SwissAdminViewService — the rounds', () => {
  it('lists the bouts of this phase, in board order', async () => {
    // Ten boards, seeded out of order, with another phase's bout alongside
    // them. The board NUMBER orders them — not the label as text, and not the
    // order the rows arrived in.
    //
    // The labels here carry no zero on purpose. A padded label sorts the same
    // way as text and as a number, so a padded fixture cannot tell the two
    // apart — and telling them apart is the whole reason `boardNumber` exists.
    const { service } = build({
      matches: {
        rows: [
          viewBout('m10', 'SW-R1-M10'),
          viewBout('m2', 'SW-R1-M2'),
          viewBout('m1', 'SW-R1-M1'),
          viewBout('m-p2', 'SW-R1-M1', { phase_id: 'p2' }),
        ],
      },
    });

    const view = await service.getAdminView('t1');

    expect(view.rounds[0]?.matches.map((m) => m.matchNumberLabel)).toEqual([
      'SW-R1-M1',
      'SW-R1-M2',
      'SW-R1-M10',
    ]);
  });

  it('carries what the organiser’s round card shows', async () => {
    const { service } = build({
      matches: {
        rows: [
          viewBout('m1', 'SW-R1-M1', {
            status: 'completed',
            scheduled_at: '2026-08-18T10:00:00.000Z',
            red_score: 5,
            blue_score: 3,
          }),
        ],
      },
    });

    const view = await service.getAdminView('t1');

    expect(view.rounds[0]?.matches[0]).toEqual({
      id: 'm1',
      matchNumberLabel: 'SW-R1-M1',
      status: 'completed',
      scheduledAt: '2026-08-18T10:00:00.000Z',
      liceName: 'Piste 1',
      redRegistrationId: 'r1',
      blueRegistrationId: 'r2',
      redScore: 5,
      blueScore: 3,
    });
  });

  it('badges a round an organiser has adjusted by hand', async () => {
    const { service } = build({
      swiss_rounds: {
        rows: [
          {
            id: 'sr1',
            phase_id: 'p1',
            round_number: 1,
            status: 'pending',
            bye_registration_id: 'r4',
            pairing_meta_json: {
              warnings: [{ code: 'forced-rematch' }],
              manualAdjustments: [{ kind: 'swap' }],
            },
            matches: [],
          },
        ],
      },
    });

    const view = await service.getAdminView('t1');

    expect(view.rounds[0]).toMatchObject({
      byeRegistrationId: 'r4',
      warnings: [{ code: 'forced-rematch' }],
      manualAdjustments: [{ kind: 'swap' }],
    });
  });

  it('validates a round against the field as it stood for that round', async () => {
    // r4 withdrew at round 2, so they were legitimately in round 1. Validating
    // round 1 against today's active list would report them as an intruder.
    const { service } = build({
      swiss_entrants: {
        rows: [
          namedEntrant('r1', 'Ada', 'Lovelace'),
          namedEntrant('r2', 'Grace', 'Hopper'),
          namedEntrant('r3', 'Alan', 'Turing'),
          { ...namedEntrant('r4', 'Edsger', 'Dijkstra'), withdrawn_at_round: 2 },
        ],
      },
    });

    const view = await service.getAdminView('t1');

    expect(view.rounds[0]?.validity.valid).toBe(true);
  });

  it('reports a round the set-sides escape hatch has broken', async () => {
    // Both bouts name r1. That is exactly what setMatchSides is allowed to
    // leave behind, and reporting it is why this payload carries validity.
    const { service } = build({
      swiss_rounds: {
        rows: [
          {
            id: 'sr1',
            phase_id: 'p1',
            round_number: 1,
            status: 'pending',
            bye_registration_id: null,
            pairing_meta_json: null,
            matches: [
              {
                id: 'm1',
                red_registration_id: 'r1',
                blue_registration_id: 'r2',
                status: 'scheduled',
              },
              {
                id: 'm2',
                red_registration_id: 'r1',
                blue_registration_id: 'r4',
                status: 'scheduled',
              },
            ],
          },
        ],
      },
    });

    const view = await service.getAdminView('t1');

    expect(view.rounds[0]?.validity.valid).toBe(false);
  });

  it('reads the rounds of this phase only', async () => {
    // Another phase's round sits in the same table.
    const { service } = build();

    const view = await service.getAdminView('t1');

    expect(view.rounds.map((r) => r.id)).toEqual(['sr1']);
  });
});

describe('SwissAdminViewService — a phase that cannot be read', () => {
  it('reports a Swiss phase whose row no longer parses as one', async () => {
    // The route found a phase; loading it disagreed. A 404 is the honest
    // answer, not a payload quietly claiming the phase has no entrants.
    const { service } = build();
    vi.spyOn(SwissPairingService.prototype, 'loadContext').mockResolvedValueOnce(null);

    await expect(service.getAdminView('t1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
