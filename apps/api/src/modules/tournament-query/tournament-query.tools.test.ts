import { describe, expect, it } from 'vitest';
import {
  buildTournamentToolDefinitions,
  detectQueryLanguage,
  normalizeQuestionAliases,
  QUERY_TOOL_SPECS,
  validateToolCall,
} from './tournament-query.tools';

describe('tournament query language and tool schemas', () => {
  it('detects French questions and normalizes HEMA aliases without changing canonical IDs', () => {
    expect(detectQueryLanguage('Quelles pistes sont en retard ?')).toBe('fr');
    expect(
      normalizeQuestionAliases('Combien de combats restent dans chaque poule sur la piste 2 ?'),
    ).toContain('pool');
    expect(
      normalizeQuestionAliases('Combien de combats restent dans chaque poule sur la piste 2 ?'),
    ).toContain('lice');
  });

  it('accepts both French words for the fighter role on input', () => {
    // The UI says "combattant" everywhere (docs/notes/glossary.md), but "tireur" is standard
    // fencing register and users type it. Dropping either one silently breaks French queries
    // for half the people asking them.
    for (const word of ['tireurs', 'combattants']) {
      expect(detectQueryLanguage(`Quels sont les meilleurs ${word} ?`)).toBe('fr');
      expect(normalizeQuestionAliases(`Quels sont les meilleurs ${word} ?`)).toContain('fighter');
    }
  });

  it('narrows weapons, pools, and lices to values from the current tournament', () => {
    const tools = buildTournamentToolDefinitions({
      weapons: ['Longsword', 'Sabre'],
      poolNames: ['Pool A', 'Pool B'],
      liceNumbers: [1, 2],
      divisions: ['open'],
    });

    const findMatches = tools.find((tool) => tool.name === 'find_matches');
    expect(findMatches?.parameters).toMatchObject({
      properties: {
        weapon: { enum: ['Longsword', 'Sabre'] },
        pool: { enum: ['Pool A', 'Pool B'] },
        ring_number: { enum: [1, 2] },
      },
    });
    const bracket = tools.find((tool) => tool.name === 'get_bracket_status');
    expect(bracket?.parameters).toMatchObject({ properties: { division: { enum: ['open'] } } });
  });

  it('takes no argument named by an id, and keeps one table of the 13 tools', () => {
    const tools = buildTournamentToolDefinitions({
      weapons: [],
      poolNames: [],
      liceNumbers: [],
      divisions: [],
    });

    expect(QUERY_TOOL_SPECS.map((spec) => spec.name).sort()).toEqual(
      [
        'compare_clubs',
        'estimate_pool_completion',
        'find_fighters',
        'find_lagging_pools',
        'find_matches',
        'get_bracket_status',
        'get_fighter_stats',
        'get_judge_stats',
        'get_pool_standings',
        'get_ring_status',
        'get_schedule_status',
        'get_tournament_summary',
        'rank_fighters',
      ].sort(),
    );
    expect(tools.map((tool) => tool.name)).toEqual(QUERY_TOOL_SPECS.map((spec) => spec.name));
    for (const tool of tools) {
      const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
      expect(Object.keys(properties).filter((arg) => arg.endsWith('_id'))).toEqual([]);
    }
  });

  it('asks for a fighter or a judge by name, and checks the pool by name', () => {
    const context = { weapons: [], poolNames: ['Pool A'], liceNumbers: [], divisions: [] };

    expect(validateToolCall({ name: 'get_fighter_stats', arguments: {} }, context)).toEqual({
      ok: false,
      message: 'fighter is required',
    });
    expect(validateToolCall({ name: 'get_judge_stats', arguments: {} }, context)).toEqual({
      ok: false,
      message: 'judge is required',
    });
    expect(
      validateToolCall({ name: 'find_matches', arguments: { pool: 'Pool Z' } }, context),
    ).toEqual({ ok: false, message: 'Unknown pool: "Pool Z". Known pools: Pool A.' });
    expect(
      validateToolCall({ name: 'find_matches', arguments: { pool: 'Pool A' } }, context).ok,
    ).toBe(true);
  });

  it('lists the known values in the refusal, capped at 20', () => {
    const context = {
      weapons: ['Longsword', 'Sabre'],
      poolNames: Array.from({ length: 25 }, (_, i) => `Pool ${i + 1}`),
      liceNumbers: [1, 2],
      divisions: ['open'],
    };
    const refused = (args: Record<string, unknown>) =>
      validateToolCall({ name: 'find_matches', arguments: args }, context).message;

    expect(refused({ weapon: 'Rapier' })).toBe(
      'Unknown weapon: "Rapier". Known weapons: Longsword, Sabre.',
    );
    expect(refused({ ring_number: 9 })).toBe('Unknown lice: "9". Known lice: 1, 2.');
    expect(
      validateToolCall(
        { name: 'get_bracket_status', arguments: { weapon: 'Longsword', division: 'x' } },
        context,
      ).message,
    ).toBe('Unknown division: "x". Known divisions: open.');
    const pools = refused({ pool: 'pool 1' })!;
    expect(pools).toContain('Pool 20, ...');
    expect(pools).not.toContain('Pool 21');
  });

  it('lists the required arguments in the panel definition', () => {
    const defs = buildTournamentToolDefinitions({
      weapons: [],
      poolNames: [],
      liceNumbers: [],
      divisions: [],
    });
    const required = Object.fromEntries(
      defs.map((def) => [def.name, (def.parameters as { required?: string[] }).required]),
    );

    expect(required['get_fighter_stats']).toEqual(['fighter']);
    expect(required['get_judge_stats']).toEqual(['judge']);
    expect(required['rank_fighters']).toEqual(['metric']);
    expect(required['get_bracket_status']).toEqual(['weapon']);
    expect(required['find_fighters']).toBeUndefined();
  });

  it('rejects unknown tools and invalid enum arguments before dispatch', () => {
    const context = {
      weapons: ['Longsword'],
      poolNames: ['Pool A'],
      liceNumbers: [1],
      divisions: [],
    };

    expect(validateToolCall({ name: 'drop_tables', arguments: {} }, context).ok).toBe(false);
    expect(
      validateToolCall(
        { name: 'rank_fighters', arguments: { metric: 'win_rate', weapon: 'Rapier' } },
        context,
      ).ok,
    ).toBe(false);
    expect(
      validateToolCall(
        { name: 'rank_fighters', arguments: { metric: 'win_rate', weapon: 'Longsword' } },
        context,
      ).ok,
    ).toBe(true);
  });
});
