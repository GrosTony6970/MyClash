import type {
  RankMetric,
  ToolCall,
  ToolValidationResult,
  TournamentToolContext,
  TournamentToolDefinition,
} from './tournament-query.types';

const TOOL_NAMES = new Set([
  'find_fighters',
  'get_fighter_stats',
  'find_matches',
  'get_pool_standings',
  'get_ring_status',
  'rank_fighters',
  'get_judge_stats',
  'compare_clubs',
  'get_bracket_status',
  'get_tournament_summary',
  'estimate_pool_completion',
  'get_schedule_status',
  'find_lagging_pools',
]);

const RANK_METRICS: RankMetric[] = [
  'wins',
  'win_rate',
  'doubles_rate',
  'afterblow_rate',
  'matches_played',
];

export function detectQueryLanguage(question: string): 'en' | 'fr' {
  const normalized = question.toLocaleLowerCase('fr-FR');
  if (
    /\b(quel|quelle|quels|quelles|combien|poule|poules|piste|pistes|tireur|tireurs|arbitre|arbitres|retard|temps|tableau|combat|combats|sommes-nous)\b/u.test(
      normalized,
    )
  ) {
    return 'fr';
  }
  return 'en';
}

export function normalizeQuestionAliases(question: string): string {
  return question
    .replace(/\bpistes?\b/giu, 'lice')
    .replace(/\bpoules?\b/giu, 'pool')
    .replace(/\btireurs?\b/giu, 'fighter')
    .replace(/\barbitres?\b/giu, 'judge')
    .replace(/\bcombats?\b/giu, 'matches')
    .replace(/\btableaux?\b/giu, 'bracket')
    .replace(/\bépee longue\b/giu, 'longsword')
    .replace(/\bépée longue\b/giu, 'longsword');
}

export function buildTournamentToolDefinitions(
  context: TournamentToolContext,
): TournamentToolDefinition[] {
  const weapon = enumSchema(context.weapons);
  const poolId = enumSchema(context.poolIds);
  const ringNumber = enumSchema(context.liceNumbers);
  const division = enumSchema(context.divisions);

  return [
    tool('find_fighters', 'Find fighters in this tournament matching filters.', {
      club_name: stringSchema(),
      country: stringSchema(),
      weapon,
      name_contains: stringSchema(),
      status: enumSchema(['active', 'eliminated', 'any']),
      limit: numberSchema(1, 200),
    }),
    tool('get_fighter_stats', 'Aggregated stats for one fighter registration.', {
      fighter_id: stringSchema(),
      weapon,
      phase: enumSchema(['pools', 'elimination', 'all']),
    }),
    tool('find_matches', 'Find matches by lice, pool, fighter, weapon, or status.', {
      ring_number: ringNumber,
      pool_id: poolId,
      fighter_id: stringSchema(),
      weapon,
      status: enumSchema(['pending', 'in_progress', 'complete', 'any']),
      limit: numberSchema(1, 200),
    }),
    tool('get_pool_standings', 'Current standings for one pool or all pools.', {
      pool_id: poolId,
      weapon,
    }),
    tool('get_ring_status', 'Status of one lice or all lices.', {
      ring_number: ringNumber,
    }),
    tool('rank_fighters', 'Rank fighters by a metric.', {
      metric: enumSchema(RANK_METRICS),
      weapon,
      phase: enumSchema(['pools', 'elimination', 'all']),
      min_matches: numberSchema(0, 100),
      order: enumSchema(['asc', 'desc']),
      limit: numberSchema(1, 50),
    }),
    tool('get_judge_stats', 'Per-judge aggregations. Accepts a judge name or id.', {
      judge_id: stringSchema(),
      weapon,
      phase: enumSchema(['pools', 'elimination', 'all']),
    }),
    tool('compare_clubs', 'Compare 2 to 5 clubs across performance metrics.', {
      club_names: { type: 'array', items: stringSchema(), minItems: 2, maxItems: 5 },
      weapon,
    }),
    tool('get_bracket_status', 'Current state of an elimination bracket.', {
      weapon,
      division,
    }),
    tool('get_tournament_summary', 'High-level tournament stats.', {
      weapon,
      scope: enumSchema(['today', 'all']),
    }),
    tool('estimate_pool_completion', 'Remaining pool matches and projected completion.', {
      pool_id: poolId,
      weapon,
    }),
    tool('get_schedule_status', 'Compare actual progress against planned schedule.', {
      scope: enumSchema(['tournament', 'weapon', 'pool', 'bracket']),
      pool_id: poolId,
      weapon,
      bracket_round: stringSchema(),
    }),
    tool('find_lagging_pools', 'Find pools or brackets running behind schedule.', {
      weapon,
      threshold_minutes: numberSchema(0, 480),
    }),
  ];
}

export function validateToolCall(
  call: ToolCall,
  context: TournamentToolContext,
): ToolValidationResult {
  if (!TOOL_NAMES.has(call.name)) {
    return { ok: false, message: `Unknown tool: ${call.name}` };
  }
  const args = call.arguments ?? {};
  const weapon = args['weapon'];
  if (
    typeof weapon === 'string' &&
    context.weapons.length > 0 &&
    !context.weapons.includes(weapon)
  ) {
    return { ok: false, message: `Unknown weapon: ${weapon}` };
  }
  const poolId = args['pool_id'];
  if (
    typeof poolId === 'string' &&
    context.poolIds.length > 0 &&
    !context.poolIds.includes(poolId)
  ) {
    return { ok: false, message: `Unknown pool: ${poolId}` };
  }
  const ringNumber = args['ring_number'];
  if (
    typeof ringNumber === 'number' &&
    context.liceNumbers.length > 0 &&
    !context.liceNumbers.includes(ringNumber)
  ) {
    return { ok: false, message: `Unknown lice: ${ringNumber}` };
  }
  const division = args['division'];
  if (
    typeof division === 'string' &&
    context.divisions.length > 0 &&
    !context.divisions.includes(division)
  ) {
    return { ok: false, message: `Unknown division: ${division}` };
  }
  if (call.name === 'rank_fighters' && !RANK_METRICS.includes(args['metric'] as RankMetric)) {
    return { ok: false, message: 'Ranking metric is required' };
  }
  if (call.name === 'get_fighter_stats' && typeof args['fighter_id'] !== 'string') {
    return { ok: false, message: 'fighter_id is required' };
  }
  if (call.name === 'get_judge_stats' && typeof args['judge_id'] !== 'string') {
    return { ok: false, message: 'judge_id is required' };
  }
  if (call.name === 'get_pool_standings' && !args['pool_id'] && !args['weapon']) {
    return { ok: false, message: 'Choose a pool or weapon for standings' };
  }
  if (call.name === 'get_bracket_status' && typeof args['weapon'] !== 'string') {
    return { ok: false, message: 'weapon is required for bracket status' };
  }
  return { ok: true };
}

function tool(
  name: string,
  description: string,
  properties: Record<string, Record<string, unknown>>,
): TournamentToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      additionalProperties: false,
    },
  };
}

function enumSchema(values: Array<string | number>) {
  return values.length > 0 ? { enum: values } : {};
}

function stringSchema() {
  return { type: 'string' };
}

function numberSchema(minimum: number, maximum: number) {
  return { type: 'number', minimum, maximum };
}
