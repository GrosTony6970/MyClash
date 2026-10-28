/**
 * The rules clock of a Tournament (`tournamentClockOf`): whether it runs, and which format phases
 * a bout has started in. Seeded rows, so every filter the clock writes is what the answer obeys.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { filtersFor, mockSupabase } from '../../common/testing/supabase-chain';
import { tournamentClockOf } from './tournament-clock';

type Row = Record<string, unknown>;

const T = 't1';

interface Seed {
  tournamentStatus?: string;
  eventStatus?: string;
  phases?: Row[];
  matches?: Row[];
}

function clockDb(seed: Seed) {
  return mockSupabase({
    tournaments: {
      rows: [
        { id: T, status: seed.tournamentStatus ?? 'draft', event_id: 'e1' },
        { id: 't-other', status: 'running', event_id: 'e1' },
      ],
    },
    events: { rows: [{ id: 'e1', status: seed.eventStatus ?? 'published' }] },
    phases: {
      rows: [...(seed.phases ?? []), { id: 'p-other', type: 'pool', tournament_id: 't-other' }],
    },
    matches: {
      rows: [
        ...(seed.matches ?? []),
        { id: 'm-other', phase_id: 'p-other', status: 'completed', match_number_label: null },
      ],
    },
  });
}

const clockOf = async (seed: Seed) => {
  const db = clockDb(seed);
  const clock = await tournamentClockOf(db.service as unknown as SupabaseClient, T);
  return { clock, db, phases: [...(clock.startedFormatPhases ?? [])].sort() };
};

const POOL = { id: 'p1', type: 'pool', tournament_id: T };
const SWISS = { id: 'p2', type: 'swiss', tournament_id: T };
const BRACKET = { id: 'p3', type: 'single_elim', tournament_id: T };

const bout = (id: string, phaseId: string, status: string, label: string | null = null) => ({
  id,
  phase_id: phaseId,
  status,
  match_number_label: label,
});

describe('tournamentClockOf: does the Tournament run', () => {
  it('a draft Tournament of a published Event with no bout runs nothing', async () => {
    const { clock, phases } = await clockOf({ phases: [POOL] });
    expect(clock.running).toBe(false);
    expect(phases).toEqual([]);
  });

  it('runs once its own status is running, bouts or not (the manual pick)', async () => {
    const { clock } = await clockOf({ tournamentStatus: 'running' });
    expect(clock.running).toBe(true);
  });

  it('runs when its Event runs AND it has bouts made, none started', async () => {
    const { clock, phases } = await clockOf({
      eventStatus: 'running',
      phases: [POOL],
      matches: [bout('m1', 'p1', 'scheduled')],
    });
    expect(clock.running).toBe(true);
    expect(phases).toEqual([]);
  });

  it('does not run when its Event runs but it has no bout made yet', async () => {
    const { clock } = await clockOf({ eventStatus: 'running', phases: [POOL] });
    expect(clock.running).toBe(false);
  });

  it("counts only its own bouts toward 'bouts made', never another Tournament's", async () => {
    const { clock } = await clockOf({ eventStatus: 'running' });
    expect(clock.running).toBe(false);
  });
});

describe('tournamentClockOf: the format phases a bout has started in', () => {
  it('a pool bout that left scheduled starts the pool, read once per phase with limit 1', async () => {
    const { phases, db } = await clockOf({
      phases: [POOL],
      matches: [bout('m1', 'p1', 'scheduled'), bout('m2', 'p1', 'completed')],
    });
    expect(phases).toEqual(['pool']);
    expect(filtersFor(db.from, 'matches', 'eq')).toContainEqual(['phase_id', 'p1']);
    expect(filtersFor(db.from, 'matches', 'neq')).toContainEqual(['status', 'scheduled']);
    expect(filtersFor(db.from, 'matches', 'limit')).toContainEqual([1]);
  });

  it('a voided bout counts as started: its cards still count (as built, commit 2)', async () => {
    const { phases } = await clockOf({ phases: [POOL], matches: [bout('m1', 'p1', 'voided')] });
    expect(phases).toEqual(['pool']);
  });

  it('a swiss bout starts the swiss phase only', async () => {
    const { phases } = await clockOf({
      phases: [POOL, SWISS],
      matches: [bout('m1', 'p1', 'scheduled'), bout('m2', 'p2', 'in_progress')],
    });
    expect(phases).toEqual(['swiss']);
  });

  it('a numbered bracket bout starts the bracket, not the finals', async () => {
    const { phases } = await clockOf({
      phases: [BRACKET],
      matches: [bout('m1', 'p3', 'completed', '1'), bout('m2', 'p3', 'scheduled', 'GOLD')],
    });
    expect(phases).toEqual(['bracket']);
  });

  it('a started medal bout starts the finals, even behind a started numbered bout', async () => {
    const { phases } = await clockOf({
      phases: [BRACKET],
      matches: [bout('m1', 'p3', 'completed', '7'), bout('m2', 'p3', 'in_progress', 'GOLD')],
    });
    expect(phases).toEqual(['bracket', 'finals']);
  });

  it('a started bout of another Tournament starts nothing here', async () => {
    const { clock, phases } = await clockOf({ phases: [POOL] });
    expect(phases).toEqual([]);
    expect(clock.running).toBe(false);
  });
});

describe('tournamentClockOf: a failed read throws, never reads as "nothing started"', () => {
  const failing = (table: string) => {
    const tables: Record<string, unknown> = {
      tournaments: { rows: [{ id: T, status: 'draft', event_id: 'e1' }] },
      events: { rows: [{ id: 'e1', status: 'running' }] },
      phases: { rows: [POOL] },
      matches: { rows: [bout('m1', 'p1', 'scheduled')] },
    };
    tables[table] = { data: null, error: { message: `${table} down` } };
    return mockSupabase(tables as Parameters<typeof mockSupabase>[0]);
  };

  it.each(['tournaments', 'events', 'phases', 'matches'])('the %s read', async (table) => {
    const db = failing(table);
    await expect(tournamentClockOf(db.service as unknown as SupabaseClient, T)).rejects.toThrow(
      `${table} down`,
    );
  });
});
