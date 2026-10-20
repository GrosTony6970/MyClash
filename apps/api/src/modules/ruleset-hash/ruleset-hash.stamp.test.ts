/**
 * The write of a Tournament's content hash.
 *
 * It was written at every save, changed or not, and the answer of the write
 * was never read: a write the database refused left the old hash in place and
 * said nothing, not even in the log.
 */
import { Logger } from '@nestjs/common';
import { FFAMHE_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  scopedTo,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { RulesetHashService } from './ruleset-hash.service';

const TOURNAMENT = {
  id: 't1',
  event_id: 'e1',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: { winBonus: 3 },
  scoring_config_json: { afterblowMode: 'deductive' },
  penalty_ruleset_id: 'pr-1',
  penalty_ruleset_version: '1.0.0',
  ruleset_content_hash: 'the-hash-before',
};

/** The live card rules the pin names: the hash reads this row, never a version snapshot. */
const PENALTY_RULESET = {
  id: 'pr-1',
  accumulation_scope: 'match',
  yellow_card_points: 0,
  red_card_points: -1,
  black_card_points: 0,
  first_black_card_forfeit: 'match',
  second_black_card_forfeit: 'tournament',
  forfeit_rules: FFAMHE_FORFEIT_RULES,
  penalty_ruleset_entries: [{ group_number: 1, ref_number: 'R1', sanctions: ['yellow', 'red'] }],
};

const seeded = (tournaments: TableSeed) =>
  mockSupabase({ tournaments, penalty_rulesets: { rows: [PENALTY_RULESET] } });

const serviceOver = (supabase: ReturnType<typeof mockSupabase>) =>
  new RulesetHashService(supabase as never, createRulesetRegistry());

const hashNow = () =>
  serviceOver(seeded({ rows: [TOURNAMENT] })).computeTournamentContentHash('t1');

afterEach(() => vi.restoreAllMocks());

describe('RulesetHashService.stampTournamentContentHash', () => {
  it('writes the hash on its Tournament when it is another one', async () => {
    const supabase = seeded({ rows: [TOURNAMENT] });

    await serviceOver(supabase).stampTournamentContentHash('t1');

    const writes = writesTo(supabase, 'tournaments');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.row).toEqual({ ruleset_content_hash: await hashNow() });
    expect(scopedTo(writes[0], 'id')).toBe('t1');
  });

  it('writes nothing when the Tournament already holds that hash', async () => {
    const supabase = seeded({ rows: [{ ...TOURNAMENT, ruleset_content_hash: await hashNow() }] });

    await serviceOver(supabase).stampTournamentContentHash('t1');

    expect(supabase.writes).toEqual([]);
  });

  it('a write the database refuses is logged with its Tournament, and the save goes on', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // The stored hash, the row the hash is computed from, then the write.
    const supabase = seeded([
      { data: TOURNAMENT, error: null },
      { data: TOURNAMENT, error: null },
      { data: null, error: { message: 'the database is away' } },
    ]);

    await expect(serviceOver(supabase).stampTournamentContentHash('t1')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('tournament t1');
    expect(warn.mock.calls[0]?.[0]).toContain('the database is away');
  });

  // The stored hash read, then the Tournament's row unreadable: read as "no Tournament", it
  // hashed as nothing and wrote an empty hash over the real one.
  it('writes no empty hash when the Tournament row cannot be read', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const supabase = seeded([
      { data: TOURNAMENT, error: null },
      { data: null, error: { message: 'connection reset' } },
    ]);

    await serviceOver(supabase).stampTournamentContentHash('t1');

    expect(supabase.writes).toEqual([]);
  });

  it('says nothing in the log when the write lands', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await serviceOver(seeded({ rows: [TOURNAMENT] })).stampTournamentContentHash('t1');

    expect(warn).not.toHaveBeenCalled();
  });
});

/** The write itself, for a door whose whole job is the hash: "Acknowledge". */
describe('RulesetHashService.writeTournamentContentHash', () => {
  it('throws when the database refuses the write', async () => {
    const supabase = seeded([
      { data: TOURNAMENT, error: null },
      { data: TOURNAMENT, error: null },
      { data: null, error: { message: 'the database is away' } },
    ]);

    await expect(serviceOver(supabase).writeTournamentContentHash('t1')).rejects.toThrow(
      'the database is away',
    );
  });

  it('throws when the stored hash cannot be read', async () => {
    const supabase = seeded([{ data: null, error: { message: 'connection reset' } }]);

    await expect(serviceOver(supabase).writeTournamentContentHash('t1')).rejects.toThrow(
      'connection reset',
    );
    expect(supabase.writes).toEqual([]);
  });
});

describe('RulesetHashService.stampEventInheritingTournaments', () => {
  it('stamps the Tournaments that take the Event default, and names them', async () => {
    const inherits = { ...TOURNAMENT, id: 't-inherits', penalty_ruleset_id: null };
    const supabase = mockSupabase({
      tournaments: {
        rows: [
          inherits,
          { ...TOURNAMENT, id: 't-own-pin' },
          { ...inherits, id: 't-elsewhere', event_id: 'e2' },
        ],
      },
      events: { rows: [{ id: 'e1', penalty_ruleset_id: 'pr-1' }] },
      penalty_rulesets: { rows: [PENALTY_RULESET] },
    });

    const stamped = await serviceOver(supabase).stampEventInheritingTournaments('e1');

    expect(stamped).toEqual(['t-inherits']);
    expect(writesTo(supabase, 'tournaments').map((write) => scopedTo(write, 'id'))).toEqual([
      't-inherits',
    ]);
  });
});
