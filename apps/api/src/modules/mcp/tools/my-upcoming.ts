import type { McpCaller, McpToolDeps } from '../mcp-server';

/** How many items a call answers when the model names no `limit`. The bounds live in the schema. */
export const MY_UPCOMING_DEFAULT_LIMIT = 20;

export interface MyUpcomingAnswer {
  upcoming: {
    kind: 'fight' | 'referee';
    eventName: string;
    eventSlug: string;
    timezone: string | null;
    scheduledAt: string;
    code: string;
    tournamentName: string | null;
    poolName: string | null;
    liceName: string | null;
    opponentName: string | null;
    isRed: boolean | null;
    role: string | null;
  }[];
}

/**
 * The person's next bouts and referee duties, soonest first: what the personal space's "Next up"
 * shows. The event and match ids are dropped; a bout is named by its code.
 */
export async function myUpcoming(
  caller: McpCaller,
  deps: McpToolDeps,
  limit: number = MY_UPCOMING_DEFAULT_LIMIT,
): Promise<MyUpcomingAnswer> {
  const items = await deps.meEvents.getUpcoming({ userId: caller.userId, staff: null }, limit);
  return {
    upcoming: items.map((item) => ({
      kind: item.kind,
      eventName: item.eventName,
      eventSlug: item.eventSlug,
      timezone: item.eventTimezone,
      scheduledAt: item.scheduledAt,
      code: item.roundCode,
      tournamentName: item.tournamentName,
      poolName: item.poolName,
      liceName: item.liceName,
      opponentName: item.opponentName,
      isRed: item.isRed,
      role: item.role,
    })),
  };
}
