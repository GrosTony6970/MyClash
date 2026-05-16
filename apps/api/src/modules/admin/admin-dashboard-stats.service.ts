import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

type CountQuery = PromiseLike<{ count: number | null; error: { message?: string } | null }> & {
  eq(column: string, value: unknown): CountQuery;
  gte(column: string, value: string): CountQuery;
  in(column: string, values: unknown[]): CountQuery;
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
}

@Injectable()
export class AdminDashboardStatsService {
  constructor(private readonly supabase: SupabaseService) {}

  async getStats(): Promise<AdminDashboardStats> {
    const recentDays = 30;
    const since = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString();

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
    ] = await Promise.all([
      this.countRows('organizations'),
      this.countRows('organizations', (query) => query.eq('status', 'active')),
      this.countRows('organizations', (query) => query.eq('status', 'suspended')),
      this.countRows('events'),
      this.countRows('events', (query) => query.eq('status', 'draft')),
      this.countRows('events', (query) => query.in('status', ['published', 'running'])),
      this.countRows('events', (query) => query.eq('status', 'completed')),
      this.countRows('tournaments'),
      this.countRows('tournaments', (query) => query.eq('status', 'draft')),
      this.countRows('tournaments', (query) => query.eq('status', 'completed')),
      this.countRows('global_persons'),
      this.countRows('global_persons', (query) => query.eq('is_fighter', true)),
      this.countRows('persons'),
      this.countRows('persons', (query) => query.eq('claim_status', 'claimed')),
      this.countRows('registrations'),
      this.countRows('matches'),
      this.countRows('matches', (query) => query.eq('status', 'completed')),
      this.countRows('exchanges'),
      this.countRows('organizations', (query) => query.gte('created_at', since)),
      this.countRows('events', (query) => query.gte('created_at', since)),
      this.countRows('tournaments', (query) => query.gte('created_at', since)),
      this.countRows('global_persons', (query) => query.gte('created_at', since)),
      this.countRows('matches', (query) => query.eq('status', 'completed').gte('ended_at', since)),
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
    };
  }

  private async countRows(
    table: string,
    apply?: (query: CountQuery) => CountQuery,
  ): Promise<number> {
    try {
      let query = this.supabase.service
        .from(table)
        .select('*', { count: 'exact', head: true }) as unknown as CountQuery;
      if (apply) query = apply(query);

      const { count, error } = await query;
      if (error) return 0;
      return count ?? 0;
    } catch {
      return 0;
    }
  }
}
