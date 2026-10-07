import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { ScoringService } from './scoring.service';

/**
 * Ruling 331: a bout a forfeit record cut short reads its sheet again once the
 * clock has put it back in play.
 *
 * Martin won by forfeit, 0-5 by the Tournament's forfeit rule, over a sheet
 * that read 3-2. The referee pressed Reopen. The forfeit was taken back, and
 * the 0-5 stayed on the paused bout until the next hit: a clock End before it
 * named Martin again.
 */
const BOUT = 'm1';
const HALTED = { status: 'halted' };
const AFTER_THE_SHEET = { status: 'halted', read: 'again' };
const FAULT = { data: null, error: { message: 'down' } };

type Seed = Record<string, unknown>;
const record = (found: string, more: Seed = {}) => ({
  match_id: BOUT,
  voided_at: null,
  previous_match_state: { status: found },
  ...more,
});
/** Another bout, completed and cut short by a forfeit: a read that names no bout finds it. */
const OTHER_BOUT = { id: 'other', status: 'completed' };
const OTHER_RECORD = record('paused', { match_id: 'other' });

function setup(status: string, records: Seed[], faults: { bout?: boolean; record?: boolean } = {}) {
  const db = mockSupabase({
    matches: faults.bout ? FAULT : { rows: [OTHER_BOUT, { id: BOUT, status }] },
    match_forfeits: faults.record ? FAULT : { rows: [OTHER_RECORD, ...records] },
  });
  const steps: string[] = [];
  const clock = {
    clockAction: vi.fn(async () => {
      steps.push('clock');
      return HALTED;
    }),
    getClockState: vi.fn().mockResolvedValue(AFTER_THE_SHEET),
  };
  const scoring = new ScoringService(db as never, undefined as never, clock as never);
  const recompute = vi.spyOn(scoring, 'recomputeMatchScore').mockImplementation(async () => {
    steps.push('sheet');
    return { redScore: 3, blueScore: 2 };
  });
  return { db, clock, scoring, recompute, steps };
}

const ACTOR = { userId: 'u1' };
const FORFEITED = [record('paused')];

describe('ScoringService.clockAction — the sheet after the clock (ruling 331)', () => {
  it.each(['paused', 'running', 'scheduled'])(
    'a bout a record ended while it was %s reads its sheet after the Reopen',
    async (found) => {
      const { clock, scoring, steps } = setup('completed', [record(found)]);

      const state = await scoring.clockAction(BOUT, 'reopen', 'why', ACTOR, true);

      expect(clock.clockAction.mock.calls).toEqual([[BOUT, 'reopen', 'why', ACTOR, true]]);
      expect(steps).toEqual(['clock', 'sheet']);
      // The sheet can end the bout and its clock: the state is read after it.
      expect(state).toBe(AFTER_THE_SHEET);
    },
  );

  it('a Start on a bout forfeited before it began reads the sheet too', async () => {
    const { scoring, steps } = setup('completed', [record('scheduled')]);

    await scoring.clockAction(BOUT, 'start');

    expect(steps).toEqual(['clock', 'sheet']);
  });

  it('a bout the board ended is not scored again: its sheet would end it at once', async () => {
    const { clock, scoring, recompute } = setup('completed', []);

    await expect(scoring.clockAction(BOUT, 'reopen')).resolves.toBe(HALTED);

    expect(recompute).not.toHaveBeenCalled();
    expect(clock.getClockState).not.toHaveBeenCalled();
  });

  it('nor is a bout fought to its end and then overridden (ruling 323)', async () => {
    const { scoring, recompute } = setup('completed', [record('completed')]);

    await scoring.clockAction(BOUT, 'reopen');

    expect(recompute).not.toHaveBeenCalled();
  });

  it('nor is a bout whose record was already taken back', async () => {
    const { scoring, recompute } = setup('completed', [
      record('paused', { voided_at: '2026-04-25T09:00:00.000Z' }),
    ]);

    await scoring.clockAction(BOUT, 'reopen');

    expect(recompute).not.toHaveBeenCalled();
  });

  it('a bout being fought pays one read, and its sheet is not read', async () => {
    // A reserve took the no-show's place: the record lives on a bout never completed.
    const { db, scoring, recompute } = setup('running', FORFEITED);

    await scoring.clockAction(BOUT, 'halt');

    expect(recompute).not.toHaveBeenCalled();
    expect(selectsFor(db.from, 'match_forfeits')).toEqual([]);
  });

  it.each<'end' | 'reset_clock'>(['end', 'reset_clock'])(
    '%s reads nothing: it takes no bout out of completed',
    async (action) => {
      const { db, scoring, recompute } = setup('completed', FORFEITED);

      await scoring.clockAction(BOUT, action);

      expect(recompute).not.toHaveBeenCalled();
      expect(selectsFor(db.from, 'matches')).toEqual([]);
    },
  );

  it('asks for the status of this bout and for its live records', async () => {
    const { db, scoring } = setup('completed', FORFEITED);

    await scoring.clockAction(BOUT, 'reopen');

    expect(selectsFor(db.from, 'matches')).toEqual(['status']);
    expect(selectsFor(db.from, 'match_forfeits')).toEqual(['previous_match_state']);
    expect(filtersFor(db.from, 'match_forfeits', 'is')).toEqual([['voided_at', null]]);
  });

  it.each<'bout' | 'record'>(['bout', 'record'])(
    'a failed read of the %s is an error, and the clock is not asked',
    async (read) => {
      const { clock, scoring } = setup('completed', FORFEITED, { [read]: true });

      await expect(scoring.clockAction(BOUT, 'reopen')).rejects.toThrow(
        /^Could not read .*: down$/,
      );

      expect(clock.clockAction).not.toHaveBeenCalled();
    },
  );

  it('a Reopen the clock refuses reads no sheet', async () => {
    const { clock, scoring, recompute } = setup('completed', FORFEITED);
    clock.clockAction.mockRejectedValue(new Error('forfeit_withdrew_fighter'));

    await expect(scoring.clockAction(BOUT, 'reopen')).rejects.toThrow('forfeit_withdrew_fighter');

    expect(recompute).not.toHaveBeenCalled();
  });

  it('a sheet that cannot be read does not undo the Reopen', async () => {
    const { scoring, recompute } = setup('completed', FORFEITED);
    recompute.mockRejectedValue(new Error('no sheet'));

    await expect(scoring.clockAction(BOUT, 'reopen')).resolves.toBe(AFTER_THE_SHEET);
  });

  it('is the door the clock route goes through', () => {
    const controller = readFileSync(join(__dirname, 'matches.controller.ts'), 'utf8');

    expect(controller).toContain('return this.matches.clockAction(');
    expect(controller).not.toContain('this.clock.clockAction(');
  });
});
