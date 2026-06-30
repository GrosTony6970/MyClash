import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

type CountQuery = PromiseLike<{ count: number | null; error: { message?: string } | null }> & {
  eq(column: string, value: unknown): CountQuery;
  gte(column: string, value: string): CountQuery;
  in(column: string, values: unknown[]): CountQuery;
  is(column: string, value: unknown): CountQuery;
};

export interface AdminDashboardStats {
  generatedAt: string;
  organizations: {
    total: number;
    active: number;
    suspended: number;
  };
  events: {
    total: number;
    draft: number;
    publishedOrRunning: number;
    completed: number;
  };
  tournaments: {
    total: number;
    draft: number;
    active: number;
    completed: number;
  };
  people: {
    globalPersons: number;
    fighters: number;
    eventPersons: number;
    claimedProfiles: number;
  };
  activity: {
    registrations: number;
    matches: number;
    completedMatches: number;
    exchanges: number;
  };
  recent: {
    days: number;
    newOrganizations: number;
    newEvents: number;
    newTournaments: number;
    newGlobalPersons: number;
    completedMatches: number;
  };
  clubs: {
    total: number;
  };
  leagues: {
    total: number;
  };
  platformUsers: {
    total: number;
  };
}

@Injectable()
export class AdminDashboardStatsService {
  constructor(private readonly supabase: SupabaseService) {}

  async getStats(): Promise<AdminDashboardStats> {
    const recentDays = 30;
    const since = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString();

    // Test events are excluded from platform stats. matches/exchanges/tournaments
    // reach the events flag via inner-join embeds (filter restricts the count).
    const notTestTournament = 'id, events!inner(is_test_event)';
    const notTestMatch = 'id, phases!inner(tournaments!inner(events!inner(is_test_event)))';
    const notTestExchange =
      'id, matches!inner(phases!inner(tournaments!inner(events!inner(is_test_event))))';

    const [
      organizationsTotal,
      organizationsActive,
      organizationsSuspended,
      eventsTotal,
      eventsDraft,
      eventsPublishedOrRunning,
      eventsCompleted,
      tournamentsTotal,
      tournamentsDraft,
      tournamentsCompleted,
      globalPersons,
      fighters,
      eventPersons,
      claimedProfiles,
      registrations,
      matches,
      completedMatches,
      exchanges,
      newOrganizations,
      newEvents,
      newTournaments,
      newGlobalPersons,
      recentCompletedMatches,
      clubsTotal,
      leaguesTotal,
      platformUsersTotal,
    ] = await Promise.all([
      this.countRows('organizations'),
      this.countRows('organizations', (query) => query.eq('status', 'active')),
      this.countRows('organizations', (query) => query.eq('status', 'suspended')),
      this.countRows('events', (query) => query.eq('is_test_event', false)),
      this.countRows('events', (query) => query.eq('status', 'draft').eq('is_test_event', false)),
      this.countRows('events', (query) =>
        query.in('status', ['published', 'running']).eq('is_test_event', false),
      ),
      this.countRows('events', (query) =>
        query.eq('status', 'completed').eq('is_test_event', false),
      ),
      this.countRows(
        'tournaments',
        (query) => query.eq('events.is_test_event', false),
        notTestTournament,
      ),
      this.countRows(
        'tournaments',
        (query) => query.eq('status', 'draft').eq('events.is_test_event', false),
        notTestTournament,
      ),
      this.countRows(
        'tournaments',
        (query) => query.eq('status', 'completed').eq('events.is_test_event', false),
        notTestTournament,
      ),
      this.countRows('global_persons'),
      this.countRows('global_persons', (query) => query.eq('is_fighter', true)),
      this.countRows('persons'),
      this.countRows('persons', (query) => query.eq('claim_status', 'claimed')),
      this.countRows('registrations'),
      this.countRows(
        'matches',
        (query) => query.eq('phases.tournaments.events.is_test_event', false),
        notTestMatch,
      ),
      this.countRows(
        'matches',
        (query) =>
          query.eq('status', 'completed').eq('phases.tournaments.events.is_test_event', false),
        notTestMatch,
      ),
      this.countRows(
        'exchanges',
        (query) => query.eq('matches.phases.tournaments.events.is_test_event', false),
        notTestExchange,
      ),
      this.countRows('organizations', (query) => query.gte('created_at', since)),
      this.countRows('events', (query) =>
        query.gte('created_at', since).eq('is_test_event', false),
      ),
      this.countRows(
        'tournaments',
        (query) => query.gte('created_at', since).eq('events.is_test_event', false),
        notTestTournament,
      ),
      this.countRows('global_persons', (query) => query.gte('created_at', since)),
      this.countRows(
        'matches',
        (query) =>
          query
            .eq('status', 'completed')
            .gte('ended_at', since)
            .eq('phases.tournaments.events.is_test_event', false),
        notTestMatch,
      ),
      this.countRows('clubs', (query) => query.is('archived_at', null)),
      this.countRows('leagues'),
      this.supabase
        .countAuthAdminUsers()
        .then((r) => r.data?.total ?? 0)
        .catch(() => 0),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      organizations: {
        total: organizationsTotal,
        active: organizationsActive,
        suspended: organizationsSuspended,
      },
      events: {
        total: eventsTotal,
        draft: eventsDraft,
        publishedOrRunning: eventsPublishedOrRunning,
        completed: eventsCompleted,
      },
      tournaments: {
        total: tournamentsTotal,
        draft: tournamentsDraft,
        active: Math.max(tournamentsTotal - tournamentsDraft - tournamentsCompleted, 0),
        completed: tournamentsCompleted,
      },
      people: {
        globalPersons,
        fighters,
        eventPersons,
        claimedProfiles,
      },
      activity: {
        registrations,
        matches,
        completedMatches,
        exchanges,
      },
      recent: {
        days: recentDays,
        newOrganizations,
        newEvents,
        newTournaments,
        newGlobalPersons,
        completedMatches: recentCompletedMatches,
      },
      clubs: { total: clubsTotal },
      leagues: { total: leaguesTotal },
      platformUsers: { total: platformUsersTotal },
    };
  }

  private async countRows(
    table: string,
    apply?: (query: CountQuery) => CountQuery,
    selectExpr = '*',
  ): Promise<number> {
    try {
      let query = this.supabase.service
        .from(table)
        .select(selectExpr, { count: 'exact', head: true }) as unknown as CountQuery;
      if (apply) query = apply(query);

      const { count, error } = await query;
      if (error) return 0;
      return count ?? 0;
    } catch {
      return 0;
    }
  }
}
