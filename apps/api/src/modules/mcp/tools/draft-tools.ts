/**
 * draft-tools.ts — Claude's draft tools (MCP slice 4b): each saves ONE assistant draft that the
 * person applies in MyClash. Every one goes through `draftGate`, refuses what Apply would refuse
 * (call X), and answers through `saveDraft`. `force` is never exposed: a draft never replaces
 * Pools or a bracket. `draft_match_schedule` is `draft-match-schedule.ts`'s.
 */
import { BadRequestException } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createTournamentSchema, rulesetCodeSchema } from '../../events/dto/events.dto';
import { catalogWeaponName } from '../../fighters/weapon-catalog.util';
import { generateBracketSchema, generatePoolsSchema } from '../../phases/dto/phases.dto';
import { buildBracketShape } from '../../phases/bracket-shape';
import { existingPhase } from '../../phases/existing-phase';
import type { McpCaller, McpToolDeps } from '../mcp-server';
import {
  DRAFT_ANNOTATIONS,
  DRAFT_NEXT,
  draftGate,
  saveDraft,
  type DraftAnswer,
  type DraftGate,
} from './draft-gate';
import { registerDraftMatchSchedule } from './draft-match-schedule';
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

export interface DraftBracketArgs {
  event: string;
  tournament: string;
  phaseType?: 'single_elim' | 'double_elim';
  qualifyCount?: number;
  bracketSize?: number;
}

/**
 * A bracket Generate Bracket cannot build refuses in the builder's words ("bracketSize (8) must
 * be ≥ fighterCount (16)"). Only with `qualifyCount`: without it, the count is the Tournament's
 * registrations at Apply, which can change before then, so Apply asks.
 */
function bracketShapeRefusal(args: DraftBracketArgs): McpRefusal | null {
  if (args.qualifyCount === undefined) return null;
  try {
    buildBracketShape(args.qualifyCount, args);
    return null;
  } catch (refused) {
    if (!(refused instanceof BadRequestException)) throw refused;
    return { refusal: `MyClash cannot build this bracket: ${refused.message}.` };
  }
}

/** `draft_bracket`: the bracket of a Tournament that has none yet. */
export async function draftBracket(
  args: DraftBracketArgs,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<DraftAnswer | McpRefusal> {
  const gate = await draftGate(args.event, caller, deps);
  if (isRefusal(gate)) return gate;
  const found = await readableTournamentIn(gate.event, args.tournament, caller, deps);
  if (isRefusal(found)) return found;
  // Either type refuses, as Generate Bracket refuses either without `force`.
  const types = ['single_elim', 'double_elim'];
  if (await existingPhase(deps.supabase.service, found.tournamentId, types)) {
    return {
      refusal: `The Tournament "${args.tournament}" already has a bracket. Change it in MyClash.`,
    };
  }
  const shape = bracketShapeRefusal(args);
  if (shape) return shape;
  const action = {
    kind: 'generate_bracket',
    tournamentId: found.tournamentId,
    ...(args.phaseType === undefined ? {} : { phaseType: args.phaseType }),
    ...(args.qualifyCount === undefined ? {} : { qualifyCount: args.qualifyCount }),
    ...(args.bracketSize === undefined ? {} : { bracketSize: args.bracketSize }),
  };
  return saveDraft(gate, [action], caller, deps);
}

const poolsInput = z
  .object({
    event: slug,
    tournament: slug,
    poolCount: generatePoolsSchema.shape.poolCount,
    targetSize: generatePoolsSchema.shape.targetSize,
    schoolSeparation: generatePoolsSchema.shape.enforceSchoolSeparation,
    skillBalance: generatePoolsSchema.shape.enforceSkillBalance,
  })
  // Exactly one: given both, Generate Pools uses poolCount and ignores the size the draft shows.
  .refine((a) => (a.poolCount === undefined) !== (a.targetSize === undefined), {
    message: 'Give poolCount or targetSize, not both.',
  });

/**
 * Create Tournament's own name rule (2 to 200 characters), on the trimmed name: a name of spaces
 * would pass it and save a draft the shape check fails.
 */
const tournamentName = z.string().trim().pipe(createTournamentSchema.shape.name);

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
        name: tournamentName,
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
        '(`tournament`), and one of `poolCount` or `targetSize` (fighters per Pool, 2 to 20); ' +
        '`schoolSeparation` keeps clubs apart, `skillBalance` spreads the ratings. Refuses a ' +
        'Tournament that already has Pools.' +
        DRAFT_NEXT,
      inputSchema: poolsInput,
      annotations: DRAFT_ANNOTATIONS,
    },
    (input) => answer('draft_pools', () => draftPools(input, caller, deps)),
  );
  registerDraftBracket(server, caller, deps);
  registerDraftMatchSchedule(server, caller, deps);
}

function registerDraftBracket(server: McpServer, caller: McpCaller, deps: McpToolDeps): void {
  server.registerTool(
    'draft_bracket',
    {
      description:
        "Draft a Tournament's bracket: the Event slug (`event`), the Tournament slug " +
        '(`tournament`), `phaseType` single_elim (the default) or double_elim, `qualifyCount` ' +
        '(the top fighters who go through, 2 or more; default every registered fighter) and ' +
        '`bracketSize` (a power of 2, up to 128). Refuses a Tournament that already has a ' +
        'bracket.' +
        DRAFT_NEXT,
      inputSchema: {
        event: slug,
        tournament: slug,
        phaseType: generateBracketSchema.shape.phaseType,
        qualifyCount: generateBracketSchema.shape.qualifyCount,
        bracketSize: generateBracketSchema.shape.bracketSize,
      },
      annotations: DRAFT_ANNOTATIONS,
    },
    (input) => answer('draft_bracket', () => draftBracket(input, caller, deps)),
  );
}
