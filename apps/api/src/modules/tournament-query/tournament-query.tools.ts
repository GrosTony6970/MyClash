import type {
  RankMetric,
  ToolCall,
  ToolValidationResult,
  TournamentToolContext,
  TournamentToolDefinition,
} from './tournament-query.types';

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
    /\b(quel|quelle|quels|quelles|combien|poule|poules|piste|pistes|tireur|tireurs|combattant|combattants|arbitre|arbitres|retard|temps|tableau|combat|combats|sommes-nous)\b/u.test(
      normalized,
    )
  ) {
    return 'fr';
  }
  return 'en';
}

export function normalizeQuestionAliases(question: string): string {
  return (
    question
      .replace(/\bpistes?\b/giu, 'lice')
      .replace(/\bpoules?\b/giu, 'pool')
      // Both words are live input: the UI says "combattant" (docs/notes/glossary.md), but
      // users type "tireur" too - it is standard fencing register. Accept both.
      .replace(/\btireurs?\b/giu, 'fighter')
      .replace(/\bcombattants?\b/giu, 'fighter')
      .replace(/\barbitres?\b/giu, 'judge')
      .replace(/\bcombats?\b/giu, 'matches')
      .replace(/\btableaux?\b/giu, 'bracket')
      .replace(/\bépee longue\b/giu, 'longsword')
      .replace(/\bépée longue\b/giu, 'longsword')
  );
}

/**
 * One argument of a tool. The kinds `weapon`, `pool`, `lice` and `division` take their values from
 * the tournament (the context); the rest are fixed here. The panel builds its JSON schema from this
 * table, and the MCP door builds its zod input from the same one.
 */
export type QueryToolArgSpec =
  | { kind: 'string' }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'enum'; values: string[] }
  | { kind: 'weapon' }
  | { kind: 'pool' }
  | { kind: 'lice' }
  | { kind: 'division' }
  | { kind: 'club_list'; min: number; max: number };

export interface QueryToolSpec {
  name: string;
  description: string;
  args: Record<string, QueryToolArgSpec>;
}

const PHASES: QueryToolArgSpec = { kind: 'enum', values: ['pools', 'elimination', 'all'] };
const WEAPON: QueryToolArgSpec = { kind: 'weapon' };
const POOL: QueryToolArgSpec = { kind: 'pool' };
const LICE: QueryToolArgSpec = { kind: 'lice' };
const TEXT: QueryToolArgSpec = { kind: 'string' };

export const QUERY_TOOL_SPECS: QueryToolSpec[] = [
  {
    name: 'find_fighters',
    description: 'Find fighters in this tournament matching filters.',
    args: {
      club_name: TEXT,
      country: TEXT,
      weapon: WEAPON,
      name_contains: TEXT,
      status: { kind: 'enum', values: ['active', 'eliminated', 'any'] },
      limit: { kind: 'number', min: 1, max: 200 },
    },
  },
  {
    name: 'get_fighter_stats',
    description: 'Aggregated stats for one fighter registration.',
    args: { fighter: TEXT, weapon: WEAPON, phase: PHASES },
  },
  {
    name: 'find_matches',
    description: 'Find matches by lice, pool, fighter, weapon, or status.',
    args: {
      ring_number: LICE,
      pool: POOL,
      fighter: TEXT,
      weapon: WEAPON,
      status: { kind: 'enum', values: ['pending', 'in_progress', 'complete', 'any'] },
      limit: { kind: 'number', min: 1, max: 200 },
    },
  },
  {
    name: 'get_pool_standings',
    description: 'Current standings for one pool or all pools.',
    args: { pool: POOL, weapon: WEAPON },
  },
  {
    name: 'get_ring_status',
    description: 'Status of one lice or all lices.',
    args: { ring_number: LICE },
  },
  {
    name: 'rank_fighters',
    description: 'Rank fighters by a metric.',
    args: {
      metric: { kind: 'enum', values: RANK_METRICS },
      weapon: WEAPON,
      phase: PHASES,
      min_matches: { kind: 'number', min: 0, max: 100 },
      order: { kind: 'enum', values: ['asc', 'desc'] },
      limit: { kind: 'number', min: 1, max: 50 },
    },
  },
  {
    name: 'get_judge_stats',
    description: 'Per-judge aggregations. Accepts a judge name.',
    args: { judge: TEXT, weapon: WEAPON, phase: PHASES },
  },
  {
    name: 'compare_clubs',
    description: 'Compare 2 to 5 clubs across performance metrics.',
    args: { club_names: { kind: 'club_list', min: 2, max: 5 }, weapon: WEAPON },
  },
  {
    name: 'get_bracket_status',
    description: 'Current state of an elimination bracket.',
    args: { weapon: WEAPON, division: { kind: 'division' } },
  },
  {
    name: 'get_tournament_summary',
    description: 'High-level tournament stats.',
    args: { weapon: WEAPON, scope: { kind: 'enum', values: ['today', 'all'] } },
  },
  {
    name: 'estimate_pool_completion',
    description: 'Remaining pool matches and projected completion.',
    args: { pool: POOL, weapon: WEAPON },
  },
  {
    name: 'get_schedule_status',
    description: 'Compare actual progress against planned schedule.',
    args: {
      scope: { kind: 'enum', values: ['tournament', 'weapon', 'pool', 'bracket'] },
      pool: POOL,
      weapon: WEAPON,
      bracket_round: TEXT,
    },
  },
  {
    name: 'find_lagging_pools',
    description: 'Find pools or brackets running behind schedule.',
    args: { weapon: WEAPON, threshold_minutes: { kind: 'number', min: 0, max: 480 } },
  },
];

export function buildTournamentToolDefinitions(
  context: TournamentToolContext,
): TournamentToolDefinition[] {
  return QUERY_TOOL_SPECS.map((spec) =>
    tool(
      spec.name,
      spec.description,
      Object.fromEntries(
        Object.entries(spec.args).map(([arg, argSpec]) => [arg, argSchema(argSpec, context)]),
      ),
    ),
  );
}

function argSchema(spec: QueryToolArgSpec, context: TournamentToolContext) {
  switch (spec.kind) {
    case 'string':
      return stringSchema();
    case 'number':
      return numberSchema(spec.min, spec.max);
    case 'enum':
      return enumSchema(spec.values);
    case 'weapon':
      return enumSchema(context.weapons);
    case 'pool':
      return enumSchema(context.poolNames);
    case 'lice':
      return enumSchema(context.liceNumbers);
    case 'division':
      return enumSchema(context.divisions);
    case 'club_list':
      return { type: 'array', items: stringSchema(), minItems: spec.min, maxItems: spec.max };
  }
}

export function validateToolCall(
  call: ToolCall,
  context: TournamentToolContext,
): ToolValidationResult {
  if (!QUERY_TOOL_SPECS.some((spec) => spec.name === call.name)) {
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
  const pool = args['pool'];
  if (
    typeof pool === 'string' &&
    context.poolNames.length > 0 &&
    !context.poolNames.includes(pool)
  ) {
    return { ok: false, message: `Unknown pool: ${pool}` };
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
  if (call.name === 'get_fighter_stats' && typeof args['fighter'] !== 'string') {
    return { ok: false, message: 'fighter is required' };
  }
  if (call.name === 'get_judge_stats' && typeof args['judge'] !== 'string') {
    return { ok: false, message: 'judge is required' };
  }
  if (call.name === 'get_pool_standings' && !args['pool'] && !args['weapon']) {
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
