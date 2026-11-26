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
    ).toEqual({ ok: false, message: 'Unknown pool: Pool Z' });
    expect(
      validateToolCall({ name: 'find_matches', arguments: { pool: 'Pool A' } }, context).ok,
    ).toBe(true);
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
