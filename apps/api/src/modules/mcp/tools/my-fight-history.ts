import { isRefusal, type McpCaller, type McpRefusal, type McpToolDeps } from '../mcp-server';
import { ownDashboard } from './no-fighter-profile';

/** How many bouts a call answers when the model names no `limit`; also the most there are to give. */
export const MY_FIGHT_HISTORY_DEFAULT_LIMIT = 10;

export interface MyFightHistoryAnswer {
  /** Completed bouts in the career; `fights` holds the newest of them, at most ten. */
  total: number;
  fights: {
    eventName: string | null;
    eventSlug: string | null;
    tournamentName: string | null;
    tournamentSlug: string | null;
    date: string | null;
    result: string;
    myScore: number;
    opponentScore: number;
  }[];
}

/**
 * The person's newest bouts, from the dashboard's career (the owner path the personal profile
 * reads, which shows a hidden profile's owner their own bouts). No opponent is named: the career
 * does not carry one. Ids are dropped; each bout is named by its Event and Tournament.
 */
export async function myFightHistory(
  caller: McpCaller,
  deps: McpToolDeps,
  limit: number = MY_FIGHT_HISTORY_DEFAULT_LIMIT,
): Promise<MyFightHistoryAnswer | McpRefusal> {
  const dashboard = await ownDashboard(caller.userId, deps);
  if (isRefusal(dashboard)) return dashboard;
  const { career } = dashboard;
  const tournamentOfMatch = new Map(career.matches.map((m) => [m.id, m.tournamentId]));
  const placementOfTournament = new Map<string, (typeof career.tournamentPlacements)[number]>();
  for (const placement of career.tournamentPlacements) {
    if (!placementOfTournament.has(placement.tournamentId)) {
      placementOfTournament.set(placement.tournamentId, placement);
    }
  }
  return {
    total: career.matches.filter((m) => m.status === 'completed').length,
    fights: career.recentForm.slice(0, limit).map((form) => {
      const tournamentId = tournamentOfMatch.get(form.matchId);
      const placement = tournamentId ? placementOfTournament.get(tournamentId) : undefined;
      return {
        eventName: placement?.eventName ?? null,
        eventSlug: placement?.eventSlug ?? null,
        tournamentName: placement?.tournamentName ?? null,
        tournamentSlug: placement?.tournamentSlug ?? null,
        date: form.date,
        result: form.outcome,
        myScore: form.ourScore,
        opponentScore: form.opponentScore,
      };
    }),
  };
}
