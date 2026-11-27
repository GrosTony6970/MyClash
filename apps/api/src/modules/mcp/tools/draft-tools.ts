/**
 * draft-tools.ts — Claude's draft tools (MCP slice 4b): each saves ONE assistant draft that the
 * person applies in MyClash. Every one goes through `draftGate`, refuses what Apply would refuse
 * (call X), and answers through `saveDraft`. `force` is never exposed: a draft never replaces
 * Pools or a bracket.
 */
import { BadRequestException } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createTournamentSchema, rulesetCodeSchema } from '../../events/dto/events.dto';
import { catalogWeaponName } from '../../fighters/weapon-catalog.util';
import { generatePoolsSchema } from '../../phases/dto/phases.dto';
import { existingPhase } from '../../phases/existing-phase';
import type { McpCaller, McpToolDeps } from '../mcp-server';
import { draftGate, saveDraft, type DraftAnswer, type DraftGate } from './draft-gate';
import { answer, isRefusal, slug, type McpRefusal } from './mcp-answer';
import { readableTournamentIn, tournamentIdBySlug } from './readable-event';

/** A Tournament's code-level ruleset when Claude names none: the one `create_tournament` uses. */
const DEFAULT_RULESET = 'TF_v1';

export interface DraftTournamentArgs {
  event: string;
  name: string;
  slug: string;
  weapon?: string;
  ruleset?: string;
}

/** A ruleset the Event's organisation cannot use refuses, as Create Tournament would. */
async function rulesetRefusal(
  deps: McpToolDeps,
  code: string,
  gate: DraftGate,
  caller: McpCaller,
): Promise<McpRefusal | null> {
  const org = { organization_id: gate.orgId };
  try {
    await deps.events.usableRulesetVersion(code, undefined, org, caller.userId);
    return null;
  } catch (refused) {
    if (!(refused instanceof BadRequestException)) throw refused;
    return { refusal: `MyClash has no ruleset "${code}" that ${gate.event.name} can use.` };
  }
}

/** `draft_tournament`: a new Tournament, by name and slug (call Y). */
export async function draftTournament(
  args: DraftTournamentArgs,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<DraftAnswer | McpRefusal> {
  const gate = await draftGate(args.event, caller, deps);
  if (isRefusal(gate)) return gate;
  const { event } = gate;
  if (await tournamentIdBySlug(deps, event.id, args.slug)) {
    return { refusal: `${event.name} already has a Tournament "${args.slug}".` };
  }
  const weapon =
    args.weapon === undefined
      ? undefined
      : await catalogWeaponName(deps.supabase.service, args.weapon);
  if (weapon === null) {
    return { refusal: `MyClash has no weapon "${args.weapon}" in its catalogue.` };
  }
  const rulesetCode = args.ruleset ?? DEFAULT_RULESET;
  const ruleset = await rulesetRefusal(deps, rulesetCode, gate, caller);
  if (ruleset) return ruleset;
  const action = {
    kind: 'create_tournament',
    name: args.name,
    slug: args.slug,
    ...(weapon === undefined ? {} : { weapon }),
    rulesetCode,
  };
  return saveDraft(gate, [action], caller, deps);
}

export interface DraftPoolsArgs {
  event: string;
  tournament: string;
  poolCount?: number;
  targetSize?: number;
  schoolSeparation?: boolean;
  skillBalance?: boolean;
}

/** `draft_pools`: Pools for a Tournament that has none yet. */
export async function draftPools(
  args: DraftPoolsArgs,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<DraftAnswer | McpRefusal> {
  const gate = await draftGate(args.event, caller, deps);
  if (isRefusal(gate)) return gate;
  const found = await readableTournamentIn(gate.event, args.tournament, caller, deps);
  if (isRefusal(found)) return found;
  if (await existingPhase(deps.supabase.service, found.tournamentId, ['pool'])) {
    return {
      refusal: `The Tournament "${args.tournament}" already has Pools. Change them in MyClash.`,
    };
  }
  const action = {
    kind: 'generate_pools',
    tournamentId: found.tournamentId,
    ...(args.poolCount === undefined ? {} : { poolCount: args.poolCount }),
    ...(args.targetSize === undefined ? {} : { targetSize: args.targetSize }),
    ...(args.schoolSeparation === undefined
      ? {}
      : { enforceSchoolSeparation: args.schoolSeparation }),
    ...(args.skillBalance === undefined ? {} : { enforceSkillBalance: args.skillBalance }),
  };
  return saveDraft(gate, [action], caller, deps);
}

/** The draft tools write a draft row and nothing in the Event (call Z). */
const DRAFT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const DRAFT_NEXT =
  ' Changes nothing in the Event: it saves a draft and answers it by name with a `link`. Tell ' +
  'the person what the draft does and give them the link; it changes the Event only when they ' +
  "press Apply in MyClash. For the organisation's admins.";

const poolsInput = z
  .object({
    event: slug,
    tournament: slug,
    poolCount: generatePoolsSchema.shape.poolCount,
    targetSize: generatePoolsSchema.shape.targetSize,
    schoolSeparation: generatePoolsSchema.shape.enforceSchoolSeparation,
    skillBalance: generatePoolsSchema.shape.enforceSkillBalance,
  })
  .refine((a) => a.poolCount !== undefined || a.targetSize !== undefined, {
    message: 'Give poolCount or targetSize.',
  });

export function registerDraftTools(server: McpServer, caller: McpCaller, deps: McpToolDeps): void {
  server.registerTool(
    'draft_tournament',
    {
      description:
        'Draft a new Tournament at an Event (`event`, its slug): its `name`, a `slug` (lowercase ' +
        'letters, digits and hyphens, new in the Event), a `weapon` by its MyClash catalogue name ' +
        'and a `ruleset` by its code (default TF_v1).' +
        DRAFT_NEXT,
      inputSchema: {
        event: slug,
        name: createTournamentSchema.shape.name,
        slug: createTournamentSchema.shape.slug,
        weapon: z.string().min(1).max(200).optional(),
        ruleset: rulesetCodeSchema.min(1).optional(),
      },
      annotations: DRAFT_ANNOTATIONS,
    },
    (input) => answer('draft_tournament', () => draftTournament(input, caller, deps)),
  );
  server.registerTool(
    'draft_pools',
    {
      description:
        "Draft a Tournament's Pools: the Event slug (`event`), the Tournament slug " +
        '(`tournament`), and `poolCount` or `targetSize` (fighters per Pool, 2 to 20); ' +
        '`schoolSeparation` keeps clubs apart, `skillBalance` spreads the ratings. Refuses a ' +
        'Tournament that already has Pools.' +
        DRAFT_NEXT,
      inputSchema: poolsInput,
      annotations: DRAFT_ANNOTATIONS,
    },
    (input) => answer('draft_pools', () => draftPools(input, caller, deps)),
  );
}
