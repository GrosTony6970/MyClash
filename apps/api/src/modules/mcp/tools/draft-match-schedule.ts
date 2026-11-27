/**
 * draft-match-schedule.ts — `draft_match_schedule` (MCP slice 4b, calls T, X). Marie asks Claude
 * to put LSW-P2-M04 on Piste 2 at 14:30 and LSW-P2-M05 on Piste 3 at 14:30; the tool saves ONE
 * draft of one `schedule_match` action per placement.
 *
 * Each Match by its round code in the Tournament, each piste by its name in the Event, each start
 * on the Event's wall clock, stored as the UTC instant. A piste two bouts would hold at once,
 * in the draft or on the board, refuses before the save: Apply runs one placement per action, so
 * a draft that collides would move its first bouts and fail on the next. Apply checks them all
 * again before it moves any (the board can fill between the draft and Apply).
 */
import { zonedToUtcIso } from '@myclash/time';
import { ConflictException, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { eventZone, unknownZoneWarning } from '../../../common/event-clock';
import type { McpCaller, McpToolDeps } from '../mcp-server';
import {
  DRAFT_ANNOTATIONS,
  DRAFT_NEXT,
  draftGate,
  saveDraft,
  type DraftAnswer,
} from './draft-gate';
import { liceNames } from './event-schedule';
import { fold, matchByCode, tournamentBouts, type TournamentBouts } from './match-by-code';
import { answer, isRefusal, slug, type McpRefusal } from './mcp-answer';
import { readableTournamentIn, type McpEvent } from './readable-event';

const logger = new Logger('DraftMatchSchedule');

export interface DraftPlacement {
  /** The bout's round code, as the app shows it (`LSW-P2-M04`). */
  match: string;
  /** The piste's name in the Event. */
  piste: string;
  /** `YYYY-MM-DD HH:MM` on the Event's wall clock. */
  start: string;
}

export interface DraftMatchScheduleArgs {
  event: string;
  tournament: string;
  placements: DraftPlacement[];
}

type ScheduleAction = {
  kind: 'schedule_match';
  matchId: string;
  liceId: string;
  scheduledAt: string;
};

/** What every placement is read against: the Tournament's bouts, the Event's pistes and zone. */
interface Board {
  event: McpEvent;
  bouts: TournamentBouts;
  lices: Map<string, string>;
  zone: string;
}

/** A day and a time, one space between: `zonedToUtcIso` checks each. */
const WALL_CLOCK = /^(\S+) (\S+)$/;

/** The start as a UTC instant, read on `zone`'s wall clock; null when it names no time. */
function startInstant(start: string, zone: string): string | null {
  const parts = WALL_CLOCK.exec(start.trim());
  return parts ? zonedToUtcIso(parts[1], parts[2], zone) : null;
}

/** The piste's id by its name in the Event, case- and accent-blind, or the refusal naming it. */
function liceByName(board: Board, piste: string): string | McpRefusal {
  const wanted = fold(piste.trim());
  const found = [...board.lices].filter(([, name]) => fold(name.trim()) === wanted);
  if (found.length === 1) return found[0]![0];
  const { name } = board.event;
  if (found.length > 1) {
    return { refusal: `Several pistes at ${name} are "${piste}": MyClash cannot tell them apart.` };
  }
  const names = [...board.lices.values()].join(', ') || 'none';
  return { refusal: `No piste "${piste}" at ${name}; its pistes are: ${names}.` };
}

/** One placement as its `schedule_match` action, or the refusal naming what cannot be read. */
function toAction(placement: DraftPlacement, board: Board): ScheduleAction | McpRefusal {
  const match = matchByCode(board.bouts, placement.match);
  if (isRefusal(match)) return match;
  const liceId = liceByName(board, placement.piste);
  if (isRefusal(liceId)) return liceId;
  const scheduledAt = startInstant(placement.start, board.zone);
  if (!scheduledAt) {
    return {
      refusal:
        `MyClash cannot read the start "${placement.start}" of ${placement.match}: give it ` +
        `as YYYY-MM-DD HH:MM on the clock of ${board.event.name}.`,
    };
  }
  return { kind: 'schedule_match', matchId: match.seat.matchId, liceId, scheduledAt };
}

/** `draft_match_schedule`: one draft that puts each Match on a piste at a time (call T). */
export async function draftMatchSchedule(
  args: DraftMatchScheduleArgs,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<DraftAnswer | McpRefusal> {
  const gate = await draftGate(args.event, caller, deps);
  if (isRefusal(gate)) return gate;
  const { event } = gate;
  const found = await readableTournamentIn(event, args.tournament, caller, deps);
  if (isRefusal(found)) return found;
  const { zone, unknownZone } = eventZone(event.timezone);
  if (unknownZone) logger.warn(unknownZoneWarning(event.id, event.timezone));
  const bouts = await tournamentBouts(deps, found.tournamentId);
  const board = { event, bouts, lices: await liceNames(event.id, deps), zone };
  const actions: ScheduleAction[] = [];
  for (const placement of args.placements) {
    const action = toAction(placement, board);
    if (isRefusal(action)) return action;
    if (actions.some((a) => a.matchId === action.matchId)) {
      return {
        refusal: `${placement.match} is placed twice: give each Match one place in a draft.`,
      };
    }
    actions.push(action);
  }
  const busy = await busyPisteRefusal(deps, event.id, actions);
  if (busy) return busy;
  return saveDraft(gate, actions, caller, deps);
}

/**
 * The placements, checked together by the one placement owner (`checkOnly`: it writes nothing),
 * against each other and against the board. Its own 409 names a bout by id, so the refusal is
 * this tool's words. Any other throw is the generic failure.
 */
async function busyPisteRefusal(
  deps: McpToolDeps,
  eventId: string,
  actions: readonly ScheduleAction[],
): Promise<McpRefusal | null> {
  const placements = actions.map(({ matchId, liceId, scheduledAt }) => ({
    matchId,
    liceId,
    scheduledAt,
  }));
  try {
    await deps.placement.placeMatches(eventId, placements, { checkOnly: true });
    return null;
  } catch (refused) {
    if (!(refused instanceof ConflictException)) throw refused;
    return {
      refusal:
        'A piste in this draft is busy at that time: a bout overlaps another one on its piste, ' +
        'in this draft or already in the schedule. Change the time or the piste.',
    };
  }
}

const placement = z.object({
  match: z.string().min(1).max(100),
  piste: z.string().min(1).max(200),
  start: z.string().min(1).max(40),
});

export function registerDraftMatchSchedule(
  server: McpServer,
  caller: McpCaller,
  deps: McpToolDeps,
): void {
  server.registerTool(
    'draft_match_schedule',
    {
      description:
        "Draft when and where a Tournament's Matches are fought: the Event slug (`event`), the " +
        'Tournament slug (`tournament`) and `placements`, 1 to 50, each a Match by its round ' +
        'code (`match`, as LSW-P2-M04), a piste by its name (`piste`) and a `start` on the ' +
        "Event's own clock as YYYY-MM-DD HH:MM (never UTC). One draft holds them all. Refuses a " +
        'piste that another bout holds at that time, in the draft or in the schedule.' +
        DRAFT_NEXT,
      inputSchema: {
        event: slug,
        tournament: slug,
        placements: z.array(placement).min(1).max(50, 'At most 50 placements in one draft.'),
      },
      annotations: DRAFT_ANNOTATIONS,
    },
    (input) => answer('draft_match_schedule', () => draftMatchSchedule(input, caller, deps)),
  );
}
