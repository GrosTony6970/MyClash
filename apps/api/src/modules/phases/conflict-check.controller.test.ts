import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ConflictCheckController } from './conflict-check.controller';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import type * as RequestUser from '../../common/auth/request-user';
import { PROGRAMME_CONFIG_DEFAULTS } from '../programme/dto/programme.dto';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { SupabaseService } from '../supabase/supabase.service';

/**
 * The fighter/referee overlap check (hard rule 8, ADR-016), through its two
 * reads: the Tournament's bouts and the referee assignments on them.
 *
 * The seeded double, and the REAL length helper behind it: the point is that
 * each side of an overlap is as long as the Event's sheet says. Every bout used
 * to be five minutes here, so each case below is built to pass under the sheet
 * and fail under the five.
 */

vi.mock('../../common/auth/request-user', async (importOriginal) => ({
  ...(await importOriginal<typeof RequestUser>()),
  resolveRequestUserId: vi.fn(() => Promise.resolve('user-1')),
}));
vi.mock('../../common/auth/event-authz', () => ({
  assertTournamentMember: vi.fn(() => Promise.resolve('org-1')),
}));

const EVENT = 'event-1';
const TOURNAMENT = 'tournament-1';
const OTHER_TOURNAMENT = 'tournament-2';

/** A bout of the Tournament's pool phase. */
function bout(id: string, scheduledAt: string, over: Record<string, unknown> = {}) {
  return {
    id,
    phase_id: 'phase-1',
    planned_duration_override_minutes: null,
    match_number_label: id.toUpperCase(),
    red_registration_id: `reg-${id}-red`,
    blue_registration_id: `reg-${id}-blue`,
    scheduled_at: scheduledAt,
    status: 'scheduled',
    ...over,
  };
}

/** The tables no case varies. Ada is the red fighter of m1. */
const FIXED_TABLES = {
  tournaments: { rows: [{ id: TOURNAMENT, event_id: EVENT }] },
  phases: {
    rows: [
      { id: 'phase-1', tournament_id: TOURNAMENT, type: 'pool' },
      // Another Tournament's phase: its bout must not be read.
      { id: 'phase-2', tournament_id: OTHER_TOURNAMENT, type: 'pool' },
    ],
  },
  registrations: {
    rows: [
      {
        id: 'reg-m1-red',
        tournament_id: TOURNAMENT,
        persons: { id: 'local-ada', global_person_id: 'gp-ada', given_name: 'Ada' },
      },
    ],
  },
};

/**
 * Ada fights m1 (as its red fighter) and referees m2. Only the times and the
 * lengths vary between cases.
 */
function tables(opts: { sheetPoolMinutes: number; m1: string; m2: string; m1Override?: number }) {
  const m1 = bout('m1', opts.m1, { planned_duration_override_minutes: opts.m1Override ?? null });
  const m2 = bout('m2', opts.m2);
  return {
    ...FIXED_TABLES,
    matches: {
      rows: [
        m1,
        m2,
        bout('m3', opts.m1, { phase_id: 'phase-2' }),
        // A voided bout is not a bout.
        bout('m4', opts.m1, { status: 'voided' }),
      ],
    },
    event_programme_configs: {
      rows: [
        {
          event_id: EVENT,
          config_json: {
            ...PROGRAMME_CONFIG_DEFAULTS,
            poolMatchDurationMinutes: opts.sheetPoolMinutes,
          },
        },
      ],
    },
    referee_assignments: {
      rows: [
        {
          event_id: EVENT,
          match_id: 'm2',
          role: 'head',
          global_persons: { id: 'gp-ada', given_name: 'Ada', family_name: 'Lovelace' },
          matches: { match_number_label: 'M2', scheduled_at: opts.m2 },
        },
      ],
    },
  };
}

function run(seed: Record<string, unknown>) {
  const supabase = mockSupabase(seed as unknown as Parameters<typeof mockSupabase>[0]);
  const controller = new ConflictCheckController(
    supabase as unknown as SupabaseService,
    {} as OrganizationsService,
  );
  return {
    supabase,
    result: controller.checkConflicts(TOURNAMENT, {} as FastifyRequest),
  };
}

describe('ConflictCheckController — each bout at its planned length', () => {
  beforeEach(() => vi.clearAllMocks());

  it("measures the bout a referee FIGHTS with the sheet's length", async () => {
    // Ada fights 09:00–09:12 and referees from 09:07. Five minutes said free.
    const { result } = run(
      tables({ sheetPoolMinutes: 12, m1: '2026-08-15T09:00:00Z', m2: '2026-08-15T09:07:00Z' }),
    );

    const { conflicts, hasConfirmedConflicts } = await result;

    expect(hasConfirmedConflicts).toBe(true);
    expect(conflicts.map((c) => [c.personId, c.fightingMatchId, c.refereeingMatchId])).toEqual([
      ['gp-ada', 'm1', 'm2'],
    ]);
  });

  it("measures the bout a referee REFEREES with the sheet's length", async () => {
    // Ada referees 08:50–09:02 and fights from 09:00. Five minutes said free.
    const { result } = run(
      tables({ sheetPoolMinutes: 12, m1: '2026-08-15T09:00:00Z', m2: '2026-08-15T08:50:00Z' }),
    );

    expect((await result).hasConfirmedConflicts).toBe(true);
  });

  it("takes a Match's own override over the sheet", async () => {
    // The sheet says 12, but m1 is planned at 5: 09:00–09:05 ends before 09:07.
    const { result } = run(
      tables({
        sheetPoolMinutes: 12,
        m1: '2026-08-15T09:00:00Z',
        m2: '2026-08-15T09:07:00Z',
        m1Override: 5,
      }),
    );

    expect((await result).conflicts).toEqual([]);
  });

  it('answers 404 when the Tournament has no Event, rather than measuring against none', async () => {
    const seed = tables({
      sheetPoolMinutes: 12,
      m1: '2026-08-15T09:00:00Z',
      m2: '2026-08-15T09:07:00Z',
    });
    const { result } = run({ ...seed, tournaments: { rows: [] } });

    await expect(result).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['tournaments', 'phases', 'matches', 'referee_assignments', 'registrations'])(
    'fails the check when the %s read fails, rather than answering an unchecked all-clear',
    async (table) => {
      // Each read left its list empty on an error, and an empty list of bouts,
      // duties or fighters reads as "nobody is in two places at once". These
      // times clash, so an answer of any kind here would be the false all-clear.
      const seed = tables({
        sheetPoolMinutes: 12,
        m1: '2026-08-15T09:00:00Z',
        m2: '2026-08-15T09:07:00Z',
      });
      const { result } = run({ ...seed, [table]: { data: null, error: { message: 'timeout' } } });

      await expect(result).rejects.toBeInstanceOf(BadRequestException);
      await expect(result).rejects.toThrow('timeout');
    },
  );

  it('touching bouts do not clash', async () => {
    const { result } = run(
      tables({ sheetPoolMinutes: 12, m1: '2026-08-15T09:00:00Z', m2: '2026-08-15T09:12:00Z' }),
    );

    expect((await result).conflicts).toEqual([]);
  });

  it('reads the columns the lengths need, from this Tournament only', async () => {
    // The double ignores the projection: without these assertions the columns
    // could leave the SELECT and every value above would still be right.
    const { supabase, result } = run(
      tables({ sheetPoolMinutes: 12, m1: '2026-08-15T09:00:00Z', m2: '2026-08-15T09:07:00Z' }),
    );
    await result;

    expect(selectsFor(supabase.from, 'matches')).toEqual([
      'id, phase_id, planned_duration_override_minutes, match_number_label, red_registration_id, blue_registration_id, scheduled_at',
    ]);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['phase_id', ['phase-1']]]);
    expect(filtersFor(supabase.from, 'matches', 'neq')).toEqual([['status', 'voided']]);
    expect(filtersFor(supabase.from, 'referee_assignments', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, 'referee_assignments', 'in')).toEqual([
      ['match_id', ['m1', 'm2']],
    ]);
    expect(filtersFor(supabase.from, 'event_programme_configs', 'eq')).toEqual([
      ['event_id', EVENT],
    ]);
  });
});
