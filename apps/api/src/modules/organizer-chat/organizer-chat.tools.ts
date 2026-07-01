import type { ToolDefinition } from '../ai-providers/adapters/provider-adapter.interface';

/**
 * The chatbot's tool surface. READ tools auto-run inside the agent loop to
 * ground answers and fetch real ids. WRITE tool names are identical to the
 * `applyAction` kinds in OrganizerAIAssistantService — a write tool call maps
 * 1:1 to `{ kind: <toolName>, ...args }` and becomes a pending draft the
 * organizer must confirm before it executes.
 */
export const READ_TOOL_NAMES = [
  'list_tournaments',
  'list_phases',
  'list_pools',
  'list_lices',
  'list_referees',
  'list_unscheduled_matches',
  'get_tournament_summary',
] as const;

export const WRITE_TOOL_NAMES = [
  'create_tournament',
  'generate_pools',
  'generate_bracket',
  'schedule_match',
  'assign_referee',
] as const;

const READ_TOOLS = new Set<string>(READ_TOOL_NAMES);
const WRITE_TOOLS = new Set<string>(WRITE_TOOL_NAMES);

export function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}
export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

type JsonSchema = { type: 'object'; properties: Record<string, unknown>; required: string[] };
const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
});

const S = { type: 'string' as const };
const INT = { type: 'integer' as const };
const BOOL = { type: 'boolean' as const };

export const ORGANIZER_CHAT_TOOLS: ToolDefinition[] = [
  {
    name: 'list_tournaments',
    description:
      'List the tournaments in this event (id, name, slug, weapon). Call this first to get tournament ids before any other tool.',
    parameters: obj({}),
  },
  {
    name: 'list_phases',
    description: 'List a tournament’s phases (pool phase, bracket phase) with ids and types.',
    parameters: obj({ tournamentId: S }, ['tournamentId']),
  },
  {
    name: 'list_pools',
    description: 'List a tournament’s pools with ids and names.',
    parameters: obj({ tournamentId: S }, ['tournamentId']),
  },
  {
    name: 'list_lices',
    description: 'List the lices (rings/pistes) of the event with ids and numbers.',
    parameters: obj({}),
  },
  {
    name: 'list_referees',
    description:
      'List referees available for the event with their person id. Use that id as `userId` when assigning a referee.',
    parameters: obj({}),
  },
  {
    name: 'list_unscheduled_matches',
    description: 'List a tournament’s matches that have no lice/time assigned yet.',
    parameters: obj({ tournamentId: S }, ['tournamentId']),
  },
  {
    name: 'get_tournament_summary',
    description: 'Counts for a tournament: fighters, pools, matches, completed matches.',
    parameters: obj({ tournamentId: S }, ['tournamentId']),
  },

  {
    name: 'create_tournament',
    description:
      'Propose creating a new tournament in this event. Requires organizer confirmation before it is created.',
    parameters: obj({ name: S, slug: S, weapon: S, rulesetCode: S }, ['name', 'slug']),
  },
  {
    name: 'generate_pools',
    description:
      'Propose generating pools for a tournament. Provide poolCount OR targetSize. Requires confirmation.',
    parameters: obj(
      {
        tournamentId: S,
        poolCount: INT,
        targetSize: INT,
        enforceSchoolSeparation: BOOL,
        enforceSkillBalance: BOOL,
        seed: INT,
      },
      ['tournamentId'],
    ),
  },
  {
    name: 'generate_bracket',
    description:
      'Propose generating an elimination bracket for a tournament. Requires confirmation.',
    parameters: obj(
      {
        tournamentId: S,
        phaseType: { type: 'string', enum: ['single_elim', 'double_elim'] },
        qualifyCount: INT,
        bracketSize: INT,
        poolPhaseId: S,
      },
      ['tournamentId'],
    ),
  },
  {
    name: 'schedule_match',
    description: 'Propose scheduling a match on a lice at a time. Requires confirmation.',
    parameters: obj(
      { matchId: S, liceId: S, scheduledAt: { type: 'string', description: 'ISO 8601 timestamp' } },
      ['matchId', 'liceId', 'scheduledAt'],
    ),
  },
  {
    name: 'assign_referee',
    description:
      'Propose assigning a referee (by person id from list_referees) to a pool or a match with a role. Requires confirmation.',
    parameters: obj(
      {
        userId: { type: 'string', description: 'person id from list_referees' },
        role: S,
        poolId: S,
        matchId: S,
      },
      ['userId', 'role'],
    ),
  },
];
