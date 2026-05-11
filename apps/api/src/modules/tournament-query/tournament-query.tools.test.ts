import { describe, expect, it } from 'vitest';
import {
  buildTournamentToolDefinitions,
  detectQueryLanguage,
  normalizeQuestionAliases,
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

  it('narrows weapons, pools, and lices to values from the current tournament', () => {
    const tools = buildTournamentToolDefinitions({
      weapons: ['Longsword', 'Sabre'],
      poolIds: ['pool-a', 'pool-b'],
      liceNumbers: [1, 2],
      divisions: ['open'],
    });

    const findMatches = tools.find((tool) => tool.name === 'find_matches');
    expect(findMatches?.parameters).toMatchObject({
      properties: {
        weapon: { enum: ['Longsword', 'Sabre'] },
        pool_id: { enum: ['pool-a', 'pool-b'] },
        ring_number: { enum: [1, 2] },
      },
    });
  });

  it('rejects unknown tools and invalid enum arguments before dispatch', () => {
    const context = {
      weapons: ['Longsword'],
      poolIds: ['pool-a'],
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
