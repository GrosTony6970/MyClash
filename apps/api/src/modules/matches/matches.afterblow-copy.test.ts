import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  supabaseChain,
  writesTo,
} from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * A bout keeps the afterblow rule it started under (ruling 2026-10-17: a bout keeps everything it
 * started under). The organiser changes the Tournament from deductive to full while a bout runs:
 * the next afterblow of that bout still nets by its copy of its rules, not by its Tournament.
 */
function setup() {
  const supabase = mockSupabase({
    match_events: { rows: [] },
    exchanges: [
      { data: null, error: null },
      { data: { id: 'ex-ab' }, error: null },
    ],
    matches: {
      rows: [
        {
          id: 'm1',
          current_round: 1,
          awaiting_round_advance: false,
          // The bout's copy: deductive, as the Tournament was when the bout started.
          match_rules: { ruleset_config: {}, scoring_config_json: { afterblowMode: 'deductive' } },
          // Its Tournament now: full. The old read took the mode from here.
          phases: { tournaments: { scoring_config_json: { afterblowMode: 'full' } } },
        },
      ],
    },
  });
  const scoring = { recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }) };
  const service = new MatchesService(
    supabase as never,
    scoring as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, supabase };
}

describe('MatchesService.createExchange — the afterblow rule of a bout', () => {
  it('nets an afterblow as deductive by its copy, though its Tournament now scores it in full', async () => {
    const { service, supabase } = setup();

    await service.createExchange('m1', {
      clientUuid: 'uuid-ab',
      sequence: 1,
      type: 'afterblow',
      occurredAt: new Date().toISOString(),
      firstStrikerColor: 'red',
      firstStrikeValue: 2,
      afterblowValue: 1,
    });

    const inserted = writesTo(supabase, 'exchanges')[0]?.row as Record<string, number>;
    // Raw values kept; the deltas are netted: red max(0, 2 - 1) = 1, blue 0. In full: 2 and 1.
    expect(inserted).toMatchObject({ first_strike_value: 2, afterblow_value: 1 });
    expect(inserted['red_score_delta']).toBe(1);
    expect(inserted['blue_score_delta']).toBe(0);
    // The double answers the whole row: the copy must be asked for by name.
    expect(selectsFor(supabase.from, 'matches')).toContain(
      'id, match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json)',
    );
  });

  it('writes no afterblow when its rule cannot be read: a failed read is not "no copy"', async () => {
    const { service, supabase } = setup();
    const from = supabase.from.getMockImplementation()!;
    supabase.from.mockImplementation((table: string) => {
      const chain = from(table);
      if (table !== 'matches') return chain;
      const select = chain.select;
      chain.select = vi.fn((asked: string, ...rest: unknown[]) =>
        asked.includes('match_rules')
          ? supabaseChain({ data: null, error: { message: 'down' } })
          : select(asked, ...rest),
      );
      return chain;
    });

    await expect(
      service.createExchange('m1', {
        clientUuid: 'uuid-ab',
        sequence: 1,
        type: 'afterblow',
        occurredAt: new Date().toISOString(),
        firstStrikerColor: 'red',
        firstStrikeValue: 2,
        afterblowValue: 1,
      }),
    ).rejects.toThrow('The rules of bout m1 were not read: down');
    expect(writesTo(supabase, 'exchanges')).toEqual([]);
  });
});
