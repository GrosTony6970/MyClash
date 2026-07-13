/**
 * event-stats.service.ts
 *
 * Organizer-facing event statistics: an event-wide rollup + per-tournament
 * summaries + an event-wide referee-workload leaderboard, all behind an
 * org-role guard (scorekeeper+). Composes the existing, tested per-tournament
 * engines — StatsService (exchange stats), PoolStandingsService (standings),
 * EventsService.getPublicTournamentStandings (header counts + bracket → podium)
 * — and adds only the net-new event-level aggregation (weighted doubles %,
 * completion %, referee workload).
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { computeFinalRanking, type RankingSlot } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { EventsService } from '../events/events.service';
import { StatsService } from '../stats/stats.service';
import { PoolStandingsService, type StandingsRow } from '../pool-standings/pool-standings.service';
import {
  buildRefereeStats,
  type RefereeAssignmentInput,
  type RefereePenaltyInput,
  type RefereeMatchDurationInput,
} from '../fighters/referee-stats';
import type {
  EventStatisticsResponse,
  RefereeWorkloadRow,
  TournamentStatSummary,
  TournamentStatsDetailResponse,
} from './dto/event-stats.dto';

interface EventRow {
  id: string;
  organization_id: string;
  slug: string | null;
  name: string | null;
}

interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  weapon: string | null;
  color: string | null;
  status: string;
}

function roundPct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

@Injectable()
export class EventStatsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly events: EventsService,
    private readonly stats: StatsService,
    private readonly poolStandings: PoolStandingsService,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  async getEventStatistics(eventId: string, userId: string): Promise<EventStatisticsResponse> {
    const event = await this.loadEventForOrganizer(eventId, userId);
    const tournaments = await this.getEventTournaments(eventId);

    // Per-tournament summaries (compose existing engines, parallel per tournament).
    const summaries = await Promise.all(
      tournaments.map((tournament) => this.buildTournamentSummary(event, tournament)),
    );

    const referees = await this.buildRefereeWorkload(
      eventId,
      tournaments.map((t) => t.id),
    );

    const clubCount = await this.countEventClubs(eventId);

    // ── Event-level rollup (net-new aggregation) ──
    const exchangeCount = summaries.reduce((s, t) => s + t.exchangeCount, 0);
    const doublesCount = summaries.reduce((s, t) => s + t.doublesCount, 0);
    const matchCount = summaries.reduce((s, t) => s + t.matchCount, 0);
    const completedMatchCount = summaries.reduce((s, t) => s + t.completedMatchCount, 0);

    return {
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        tournamentCount: tournaments.length,
        participantCount: summaries.reduce((s, t) => s + t.participantCount, 0),
        matchCount,
        completedMatchCount,
        completionPercent: roundPct(completedMatchCount, matchCount),
        exchangeCount,
        doublesCount,
        // Weighted event doubles rate — Σ doubles / Σ exchanges, NOT a mean of
        // per-tournament percentages (that would over-weight tiny tournaments).
        doublesPercent: roundPct(doublesCount, exchangeCount),
        clubCount,
      },
      tournaments: summaries,
      referees,
    };
  }

  async getTournamentDetail(
    eventId: string,
    tournamentId: string,
    userId: string,
  ): Promise<TournamentStatsDetailResponse> {
    await this.loadEventForOrganizer(eventId, userId);
    await this.assertTournamentInEvent(eventId, tournamentId);

    const [standings, fighters] = await Promise.all([
      this.poolStandings.getPoolStandings(tournamentId, 'overall'),
      this.stats.getFighterStats(tournamentId),
    ]);

    // 'overall' mode always returns the { rows } variant.
    const rows = 'rows' in standings ? standings.rows : [];
    return {
      tournamentId,
      standings: {
        columns: standings.columns,
        rows: rows.map((r: StandingsRow) => ({
          rank: r.rank,
          registrationId: r.registrationId,
          displayName: r.displayName,
          club: r.club,
          stats: r.stats,
        })),
      },
      fighters,
    };
  }

  // ── Per-tournament summary ──────────────────────────────────────────────────

  private async buildTournamentSummary(
    event: EventRow,
    tournament: TournamentRow,
  ): Promise<TournamentStatSummary> {
    const [overview, standings] = await Promise.all([
      this.stats.getTournamentOverview(tournament.id),
      // Reuse the tested public assembly for header counts + bracket → podium.
      event.slug
        ? this.events.getPublicTournamentStandings(event.slug, tournament.slug)
        : Promise.resolve(null),
    ]);

    const header = (standings?.tournament as Record<string, unknown> | undefined) ?? {};
    const slots = (standings as { bracketSlots?: RankingSlot[] } | null)?.bracketSlots ?? [];
    const podium = computeFinalRanking(slots, [])
      .slice(0, 3)
      .map((e) => ({ place: e.place, fighterName: e.fighterName, club: e.clubAbbrev ?? null }));

    // Header participant/completed counts are the canonical "registered" figures
    // (match the public tournament card); overview.matchCount is the non-voided
    // total, so completion% = completed / total.
    const participantCount = Number(header['participantCount'] ?? overview.participantCount ?? 0);
    const completedMatchCount = Number(header['completedMatchCount'] ?? 0);

    return {
      id: tournament.id,
      name: tournament.name,
      slug: tournament.slug,
      weapon: tournament.weapon,
      color: tournament.color,
      status: tournament.status,
      participantCount,
      matchCount: overview.matchCount,
      completedMatchCount,
      completionPercent: roundPct(completedMatchCount, overview.matchCount),
      exchangeCount: overview.exchangeCount,
      doublesCount: overview.doublesCount,
      doublesPercent: overview.doublesPercent,
      clubCount: overview.clubCount,
      podium,
      topFighters: overview.topFighters.map((f) => ({
        name: f.name,
        club: f.club,
        hitRatio: f.hitRatio,
      })),
    };
  }

  // ── Event-wide referee workload (net-new) ───────────────────────────────────

  private async buildRefereeWorkload(
    eventId: string,
    tournamentIds: string[],
  ): Promise<RefereeWorkloadRow[]> {
    // Match-scope referee assignments across the whole event, with match status
    // + active duration for the workload rollup.
    const { data: assignData, error: assignErr } = await this.supabase.service
      .from('referee_assignments')
      .select('match_id, person_id, role, matches(id, status, duration_active_ms)')
      .eq('event_id', eventId)
      .eq('scope_type', 'match')
      .not('match_id', 'is', null);
    if (assignErr) throw new BadRequestException(assignErr.message);

    type AssignRow = {
      match_id: string;
      person_id: string;
      role: string | null;
      matches: { id: string; status: string; duration_active_ms: number | null } | null;
    };
    const rows = (assignData ?? []) as unknown as AssignRow[];

    // Only completed matches count toward workload (mirrors referee-stats).
    const completed = rows.filter((r) => r.matches?.status === 'completed');
    if (completed.length === 0) return [];

    const assignments: RefereeAssignmentInput[] = completed.map((r) => ({
      matchId: r.match_id,
      userId: r.person_id,
      role: r.role,
      eventId,
    }));

    const durationByMatch = new Map<string, RefereeMatchDurationInput>();
    for (const r of completed) {
      if (!durationByMatch.has(r.match_id)) {
        durationByMatch.set(r.match_id, {
          matchId: r.match_id,
          durationActiveMs: r.matches?.duration_active_ms ?? null,
        });
      }
    }
    const durations = [...durationByMatch.values()];

    const penalties = await this.getEventPenalties(tournamentIds);
    const namesByPerson = await this.resolvePersonNames([
      ...new Set(assignments.map((a) => a.userId)),
    ]);

    const personIds = [...new Set(assignments.map((a) => a.userId))];
    const workload = personIds.map((personId): RefereeWorkloadRow => {
      // buildRefereeStats filters to this ref's assignments internally, and
      // attributes cards to the match declarant — so pass the full event lists.
      const s = buildRefereeStats({ userId: personId, assignments, durations, penalties });
      return {
        personId,
        name: namesByPerson.get(personId) ?? '—',
        matchesReffed: s.totalMatches,
        roles: s.roles,
        cards: s.cards,
        averageRefereeTimeMs: s.averageRefereeTimeMs,
      };
    });

    return workload
      .filter((w) => w.matchesReffed > 0)
      .sort((a, b) => b.matchesReffed - a.matchesReffed || a.name.localeCompare(b.name));
  }

  private async getEventPenalties(tournamentIds: string[]): Promise<RefereePenaltyInput[]> {
    if (tournamentIds.length === 0) return [];
    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .select('match_id, card, voided')
      .in('tournament_id', tournamentIds)
      .eq('voided', false);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<{ match_id: string; card: string; voided: boolean }>).map(
      (r) => ({
        matchId: r.match_id,
        card: r.card,
        voided: r.voided,
      }),
    );
  }

  /** Resolve referee identities (person_id = global_persons.id) to display
   *  names — never surface raw ids in the UI. */
  private async resolvePersonNames(personIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (personIds.length === 0) return names;
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id, given_name, family_name')
      .in('id', personIds);
    if (error) throw new BadRequestException(error.message);
    for (const r of (data ?? []) as Array<{
      id: string;
      given_name: string | null;
      family_name: string | null;
    }>) {
      const name = `${r.given_name ?? ''} ${r.family_name ?? ''}`.trim();
      if (name) names.set(r.id, name);
    }
    return names;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async loadEventForOrganizer(eventId: string, userId: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id, slug, name')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    const event = data as EventRow;
    await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');
    return event;
  }

  private async getEventTournaments(eventId: string): Promise<TournamentRow[]> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, slug, name, weapon, color, status')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as TournamentRow[];
  }

  private async assertTournamentInEvent(eventId: string, tournamentId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('id', tournamentId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data)
      throw new NotFoundException(`Tournament ${tournamentId} not found in event ${eventId}`);
  }

  private async countEventClubs(eventId: string): Promise<number> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('club_id')
      .eq('event_id', eventId)
      .not('club_id', 'is', null);
    if (error) throw new BadRequestException(error.message);
    const clubs = new Set(
      ((data ?? []) as Array<{ club_id: string | null }>)
        .map((r) => r.club_id)
        .filter((id): id is string => Boolean(id)),
    );
    return clubs.size;
  }
}
