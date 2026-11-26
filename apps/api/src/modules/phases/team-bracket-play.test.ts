import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { singleElimBracket } from '@myclash/rules/scheduling';
import {
  mockSupabase,
  selectsFor,
  type RecordedFilter,
  type RecordedWrite,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { assertBothSides, sidesOf } from '../matches/bout-sides';
import { TournamentCompletionService } from '../tournament-completion/tournament-completion.service';
import { BracketAdvanceService } from './bracket-advance.service';
import { MatchCompletionService } from './match-completion.service';

/**
 * Team Longsword plays its bracket of four to a champion. Its Pools ranked team-1 to team-4; the
 * bracket was populated from them, so each semi-final holds two teams and the final and the
 * bronze bout wait. A side of a slot and of a bout holds a Registration or a team (0282): a team
 * bout's Registration columns are null, so every advance, clear and completion reads the side.
 *
 * The double below applies each write to its rows before the next query, so one bout's result
 * is what the next read sees.
 */

const T = 't-team';
const PHASE = 'bracket-1';

/** The slots of a bracket of four, as generation writes them, with the Pool ranking placed. */
function slotRows(): SupabaseRow[] {
  return singleElimBracket(4).slots.map((slot) => ({
    id: `slot-R${slot.round}P${slot.position}`,
    phase_id: PHASE,
    round: slot.round,
    position: slot.position,
    source_a_type: slot.sourceAType,
    source_a_ref: slot.homeSource,
    source_b_type: slot.sourceBType,
    source_b_ref: slot.awaySource,
    registration_a_id: null,
    registration_b_id: null,
    team_a_id: slot.homeSeed ? `team-${slot.homeSeed}` : null,
    team_b_id: slot.awaySeed ? `team-${slot.awaySeed}` : null,
  }));
}

/** The bout of each slot (the placeholders generation makes), sides copied from the slot. */
function boutRows(slots: SupabaseRow[]): SupabaseRow[] {
  return slots.map((slot) => ({
    id: `m-R${String(slot['round'])}P${String(slot['position'])}`,
    bracket_slot_id: slot['id'],
    phase_id: PHASE,
    status: 'scheduled',
    started_at: null,
    red_registration_id: null,
    blue_registration_id: null,
    red_team_id: slot['team_a_id'],
    blue_team_id: slot['team_b_id'],
    winner_registration_id: null,
    winner_team_id: null,
    // The bout's phase, as its `phases!inner(…)` reads embed it and filter on it.
    phases: { tournament_id: T, type: 'single_elim' },
    'phases.tournament_id': T,
    'phases.type': 'single_elim',
  }));
}

const hit = (row: SupabaseRow, filter: RecordedFilter): boolean => {
  const [column, value] = filter.args as [string, unknown];
  if (filter.method === 'eq') return row[column] === value;
  if (filter.method === 'in') return (value as unknown[]).includes(row[column]);
  if (filter.method === 'is') return (row[column] ?? null) === value;
  throw new Error(`the play double does not apply a write filtered by ${filter.method}`);
};

/** Applies a write to the rows it names. */
function apply(rows: SupabaseRow[], write: RecordedWrite): void {
  const named = rows.filter((row) => write.filters.every((filter) => hit(row, filter)));
  if (write.op !== 'update') throw new Error(`the play double does not apply ${write.op}`);
  for (const row of named) Object.assign(row, write.row);
}

/** The seeded double over `tables`, with every write applied to its rows before the next query. */
function liveDouble(tables: Record<string, SupabaseRow[]>) {
  const db = mockSupabase(
    Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, { rows }])),
  );
  let applied = 0;
  const flush = () => {
    for (; applied < db.writes.length; applied += 1) {
      const write = db.writes[applied]!;
      apply(tables[write.table]!, write);
    }
  };
  const from = vi.fn((table: string) => {
    flush();
    return db.from(table);
  });
  return { supabase: { service: { from, rpc: db.rpc } }, from, flush };
}

function setup() {
  const slots = slotRows();
  const tables: Record<string, SupabaseRow[]> = {
    tournaments: [{ id: T, status: 'running', entrant_kind: 'team' }],
    phases: [
      {
        id: PHASE,
        type: 'single_elim',
        config_json: {},
        tournament_id: T,
        tournaments: { entrant_kind: 'team' },
      },
    ],
    bracket_slots: slots,
    matches: boutRows(slots),
  };
  const { supabase, from, flush } = liveDouble(tables);
  const resultsPublished = vi.fn().mockResolvedValue(undefined);
  const advance = new BracketAdvanceService(supabase as never);
  const completion = new MatchCompletionService(
    supabase as never,
    {} as never,
    advance,
    undefined,
    undefined,
    new TournamentCompletionService(supabase as never, { resultsPublished } as never),
  );
  const row = (table: string, id: string) => {
    flush();
    return tables[table]!.find((r) => r['id'] === id)!;
  };
  /** A bout ends with a team's win, as scoring writes it (`winnerColumns`), then its side effects. */
  const win = async (boutId: string, team: string | null) => {
    Object.assign(row('matches', boutId), {
      status: 'completed',
      winner_registration_id: null,
      winner_team_id: team,
    });
    await completion.onMatchCompleted(boutId);
    flush();
  };
  return { from, row, win, completion, resultsPublished };
}

const teamSides = (a: string | null, b: string | null) => ({
  registration_a_id: null,
  team_a_id: a,
  registration_b_id: null,
  team_b_id: b,
});
const teamBout = (red: string | null, blue: string | null) => ({
  red_registration_id: null,
  red_team_id: red,
  blue_registration_id: null,
  blue_team_id: blue,
});

describe('a team bracket of four plays to a champion', () => {
  it('sends the semi-final winners to the final and the losers to the bronze bout, by team', async () => {
    const play = setup();
    // Seed 1 meets seed 4 in R1P1; seed 3 meets seed 2 in R1P2 (`singleElimBracket`).
    expect(play.row('bracket_slots', 'slot-R1P1')).toMatchObject(teamSides('team-1', 'team-4'));

    await play.win('m-R1P1', 'team-1');
    await play.win('m-R1P2', 'team-2');

    expect(play.row('bracket_slots', 'slot-R2P1')).toMatchObject(teamSides('team-1', 'team-2'));
    expect(play.row('matches', 'm-R2P1')).toMatchObject(teamBout('team-1', 'team-2'));
    expect(play.row('bracket_slots', 'slot-R2P2')).toMatchObject(teamSides('team-4', 'team-3'));
    expect(play.row('matches', 'm-R2P2')).toMatchObject(teamBout('team-4', 'team-3'));
    // Two bouts are left: the Tournament runs on.
    expect(play.row('tournaments', T)['status']).toBe('running');
  });

  it('completes the Tournament once the final and the bronze bout are won by teams', async () => {
    const play = setup();
    await play.win('m-R1P1', 'team-1');
    await play.win('m-R1P2', 'team-2');

    await play.win('m-R2P1', 'team-2');
    expect(play.row('tournaments', T)['status']).toBe('running');
    await play.win('m-R2P2', 'team-3');

    expect(play.row('tournaments', T)['status']).toBe('completed');
    expect(play.resultsPublished).toHaveBeenCalledWith(T);
    expect(play.row('matches', 'm-R2P1')['winner_team_id']).toBe('team-2');
  });

  it('reads the bout, the slot and the kind with both kinds of side', async () => {
    const play = setup();
    await play.win('m-R1P1', 'team-1');

    // The double ignores the projection: each read is asserted whole.
    expect(selectsFor(play.from, 'phases')).toContain(
      'id, type, config_json, tournaments!inner(entrant_kind)',
    );
    expect(selectsFor(play.from, 'matches')).toContain(
      'id, bracket_slot_id, winner_registration_id, winner_team_id, red_registration_id, red_team_id, blue_registration_id, blue_team_id',
    );
    // The bout's own slot (`loadSlot`) and the slots it feeds (`advanceFromSlot`).
    const slotSelects = selectsFor(play.from, 'bracket_slots');
    expect(slotSelects).toContain(
      'id, round, position, phase_id, source_b_type, registration_a_id, registration_b_id, team_a_id, team_b_id',
    );
    expect(slotSelects).toContain(
      'id, round, position, phase_id, source_a_type, source_a_ref, source_b_type, source_b_ref, registration_a_id, registration_b_id, team_a_id, team_b_id',
    );
  });
});

describe('a semi-final of a team bracket changes its result', () => {
  it('a result with no winner empties the final, and the final refuses Start (ruling 960)', async () => {
    const play = setup();
    await play.win('m-R1P1', 'team-1');
    await play.win('m-R1P2', 'team-2');

    Object.assign(play.row('matches', 'm-R1P1'), { winner_team_id: null });
    await play.completion.onResultChanged('m-R1P1', false);

    // The slot keeps the side R1P2 fed; the bout is emptied whole, and waits on its feeder.
    expect(play.row('bracket_slots', 'slot-R2P1')).toMatchObject(teamSides(null, 'team-2'));
    const final = play.row('matches', 'm-R2P1');
    expect(final).toMatchObject(teamBout(null, null));
    expect(() => assertBothSides(sidesOf(final))).toThrow(ConflictException);
    // The bronze bout lost its loser of R1P1 the same way.
    expect(play.row('bracket_slots', 'slot-R2P2')).toMatchObject(teamSides(null, 'team-3'));
    expect(play.row('matches', 'm-R2P2')).toMatchObject(teamBout(null, null));
  });

  it('another winner takes the place of the first in the final and the bronze bout', async () => {
    const play = setup();
    await play.win('m-R1P1', 'team-1');
    await play.win('m-R1P2', 'team-2');

    Object.assign(play.row('matches', 'm-R1P1'), { winner_team_id: 'team-4' });
    await play.completion.onResultChanged('m-R1P1', false);

    expect(play.row('bracket_slots', 'slot-R2P1')).toMatchObject(teamSides('team-4', 'team-2'));
    expect(play.row('matches', 'm-R2P1')).toMatchObject(teamBout('team-4', 'team-2'));
    expect(play.row('matches', 'm-R2P2')).toMatchObject(teamBout('team-1', 'team-3'));
  });
});
