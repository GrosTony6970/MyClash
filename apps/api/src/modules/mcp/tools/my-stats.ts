import type { McpCaller, McpToolDeps } from '../mcp-server';
import { isRefusal, type McpRefusal } from './mcp-answer';
import { ownDashboard } from './no-fighter-profile';

interface BoutTally {
  bouts: number;
  wins: number;
  losses: number;
}

export interface MyStatsAnswer {
  career: BoutTally & {
    draws: number;
    winLossRatio: number | null;
    doubleHits: number;
    exchanges: number;
    doubleHitPercentage: number;
    currentStreak: { kind: 'win' | 'loss' | 'none'; count: number };
    tournamentsAttended: number;
    byWeapon: (BoutTally & { weapon: string })[];
  };
  refereeing: {
    totalMatches: number;
    averageRefereeTimeMs: number;
    eventsWorked: number;
    roles: Record<string, number>;
    cards: Record<string, number>;
  };
  hemaRatings: { weapon: string; rank: number | null; weightedRating: number }[];
}

/**
 * The summary numbers the personal dashboard shows: career bouts, per-weapon tallies, referee
 * totals and per-weapon HEMA Ratings. Each field is picked by hand. The profile (email, date of
 * birth, phone), the penalty and protest lists, the referee history and the referee "best buddies"
 * (other people) are left out on purpose.
 */
export async function myStats(
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<MyStatsAnswer | McpRefusal> {
  const dashboard = await ownDashboard(caller.userId, deps);
  if (isRefusal(dashboard)) return dashboard;
  const { career, refereeStats, hemaRatings } = dashboard;
  const overall = career.stats.overall;
  return {
    career: {
      bouts: overall.matches,
      wins: overall.wins,
      losses: overall.losses,
      // A bout with neither a win nor a loss is a draw: the same arithmetic the career tally uses.
      draws: overall.matches - overall.wins - overall.losses,
      winLossRatio: overall.winLossRatio,
      doubleHits: overall.doubleHits,
      exchanges: overall.exchanges,
      doubleHitPercentage: overall.doubleHitPercentage,
      currentStreak: career.currentStreak,
      tournamentsAttended: career.tournamentsAttended,
      // The career types each row as bare stats; at runtime every byWeapon row carries its weapon.
      byWeapon: career.stats.byWeapon.map((row) => {
        const w = row as typeof row & { weapon: string };
        return { weapon: w.weapon, bouts: w.matches, wins: w.wins, losses: w.losses };
      }),
    },
    refereeing: {
      totalMatches: refereeStats.totalMatches,
      averageRefereeTimeMs: refereeStats.averageRefereeTimeMs,
      eventsWorked: refereeStats.eventsWorked,
      // Keyed by the raw role: the stats carry no skill names, so a custom role shows as its id.
      roles: { ...refereeStats.roles },
      cards: { ...refereeStats.cards },
    },
    hemaRatings: (hemaRatings?.ratings ?? []).map((r) => ({
      weapon: r.weapon,
      rank: r.rank,
      weightedRating: r.weightedRating,
    })),
  };
}
