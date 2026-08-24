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
import { computeFinalRanking, rankingBracketShape, type RankingSlot } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { CLOCK_SKEW_REPORT_MS } from '../events/clock-reconciliation';
import {
  buildPostEventReport,
  type ArrivalRow,
  type DeviceSyncRow,
  type OverrideRow,
  type PostEventReport,
} from './post-event-report';
import { OrganizationsService } from '../organizations/organizations.service';
import { EventsService } from '../events/events.service';
import { StatsService } from '../stats/stats.service';
import { aggregateTargetValues, type TargetValueRow } from '../stats/target-value-stats';
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
  WeaponTargetStats,
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

/** How long after the fleet's last report a device counts as having gone quiet. */
const SILENCE_GRACE_MS = 10 * 60 * 1000;

function roundPct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Top three from a public-standings payload's bracket.
 *
 * The bracket SHAPE has to be passed through: a double-elim podium reads the
 * last PLAYED grand final (an enabled-but-unplayed reset would otherwise read
 * as an undecided bracket and blank the podium), and its 3rd place is the
 * losers-bracket final's loser rather than a bronze-match winner.
 */
function topThreeFrom(standings: unknown): TournamentStatSummary['podium'] {
  const bracket = (standings ?? {}) as { bracketSlots?: RankingSlot[]; phaseType?: string | null };
  return computeFinalRanking(bracket.bracketSlots ?? [], [], null, rankingBracketShape(bracket))
    .slice(0, 3)
    .map((e) => ({ place: e.place, fighterName: e.fighterName, club: e.clubAbbrev ?? null }));
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
      tournaments.map((tournament) => this.buildTournamentSummary(event, tournament, userId)),
    );

    const referees = await this.buildRefereeWorkload(
      eventId,
      tournaments.map((t) => t.id),
    );

    const [clubCount, uniqueCounts, targetEntries] = await Promise.all([
      this.countEventClubs(eventId),
      // Distinct-people headcounts, shared with the Command Center dashboard so
      // both surfaces report identical unique fighter/referee numbers.
      this.events.getEventUniqueParticipantCounts(eventId),
      // Per-tournament point-value rows (for the per-weapon deep-target / point
      // distribution breakdown), fetched in parallel per tournament.
      Promise.all(
        tournaments.map(async (tournament) => ({
          tournament,
          rows: await this.stats.getTargetValueRows(tournament.id),
        })),
      ),
    ]);

    const weaponBreakdown = this.buildWeaponBreakdown(targetEntries);

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
        uniqueFighters: uniqueCounts.uniqueFighters,
        uniqueReferees: uniqueCounts.uniqueReferees,
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
      weaponBreakdown,
    };
  }

  /**
   * Group per-tournament point-value rows by weapon and aggregate each group
   * (deep-target hunters merged by person across same-weapon tournaments, plus
   * the point-value distribution). weapon=null tournaments group under a sentinel.
   */
  private buildWeaponBreakdown(
    entries: Array<{ tournament: TournamentRow; rows: TargetValueRow[] }>,
  ): WeaponTargetStats[] {
    const NULL_KEY = '\x00__no_weapon__';
    const rowsByKey = new Map<string, TargetValueRow[]>();
    const labelByKey = new Map<string, string | null>();

    for (const { tournament, rows } of entries) {
      const key = tournament.weapon ?? NULL_KEY;
      labelByKey.set(key, tournament.weapon);
      const acc = rowsByKey.get(key) ?? [];
      acc.push(...rows);
      rowsByKey.set(key, acc);
    }

    const out: WeaponTargetStats[] = [];
    for (const [key, rows] of rowsByKey) {
      const agg = aggregateTargetValues(rows);
      // Skip weapons with no clean-hit data — nothing to show.
      if (agg.distribution.length === 0) continue;
      out.push({
        weapon: labelByKey.get(key) ?? null,
        maxValue: agg.maxValue,
        distribution: agg.distribution,
        hunters: agg.hunters,
      });
    }

    // Stable order: weapon name asc, null weapon last.
    return out.sort((a, b) => (a.weapon ?? '￿').localeCompare(b.weapon ?? '￿'));
  }

  async getTournamentDetail(
    eventId: string,
    tournamentId: string,
    userId: string,
  ): Promise<TournamentStatsDetailResponse> {
    await this.loadEventForOrganizer(eventId, userId);
    await this.assertTournamentInEvent(eventId, tournamentId);

    const [standings, fighterStats] = await Promise.all([
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
      fighters: fighterStats.fighters,
      // How this tournament's ruleset values an afterblow, so the blow table can
      // label its afterblow columns instead of asserting FFAMHE's flat 1.
      afterblow: fighterStats.afterblow,
    };
  }

  // ── Per-tournament summary ──────────────────────────────────────────────────

  private async buildTournamentSummary(
    event: EventRow,
    tournament: TournamentRow,
    userId: string,
  ): Promise<TournamentStatSummary> {
    const [overview, standings] = await Promise.all([
      this.stats.getTournamentOverview(tournament.id),
      // Reuse the tested public assembly for header counts + bracket → podium.
      // The REAL caller, not a stand-in: that assembly hides an unannounced
      // event from non-members, and loadEventForOrganizer already proved this
      // one is a member.
      event.slug
        ? this.events.getPublicTournamentStandings(event.slug, tournament.slug, () =>
            Promise.resolve(userId),
          )
        : Promise.resolve(null),
    ]);

    const header = (standings?.tournament as Record<string, unknown> | undefined) ?? {};
    const podium = topThreeFrom(standings);

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

  /**
   * The post-event report. Gathering only — every rule lives in
   * `post-event-report.ts`, mirroring event-readiness and clock-reconciliation.
   *
   * Composes sources that are genuinely EVENT-SCOPED. `query_error_events` is
   * not one of them: it is fingerprint-aggregated platform-wide with no
   * event_id, so slicing it by the event's dates would present unrelated noise
   * as this event's findings. It stays on the platform log.
   */
  async getPostEventReport(eventId: string, userId: string): Promise<PostEventReport> {
    await this.loadEventForOrganizer(eventId, userId);

    const [devices, overrides, arrivals, clockFlaggedCount] = await Promise.all([
      this.loadDeviceReports(eventId),
      this.loadOverrides(eventId),
      this.loadArrivals(eventId),
      this.countFlaggedClocks(eventId),
    ]);

    // A device is "silent" if it has not reported since the most recent report
    // any device made, less one grace window. Anchored to the FLEET rather than
    // to now(): the report is read after the event, when every device is off,
    // and a wall-clock cutoff would flag all of them.
    const latest = devices.reduce(
      (max, device) => (device.lastReportedAt > max ? device.lastReportedAt : max),
      '',
    );
    const cutoff = latest
      ? new Date(new Date(latest).getTime() - SILENCE_GRACE_MS).toISOString()
      : new Date(0).toISOString();

    return buildPostEventReport({ devices, overrides, arrivals, clockFlaggedCount }, cutoff);
  }

  private async loadDeviceReports(eventId: string): Promise<DeviceSyncRow[]> {
    const { data, error } = await this.supabase.service
      .from('scoring_device_sync_reports')
      .select(
        'device_id, device_label, quarantined_count, peak_quarantined_count, reason_codes, last_reported_at',
      )
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      deviceId: String(row['device_id']),
      deviceLabel: (row['device_label'] as string | null) ?? null,
      quarantinedCount: Number(row['quarantined_count'] ?? 0),
      peakQuarantinedCount: Number(row['peak_quarantined_count'] ?? 0),
      reasonCodes: (row['reason_codes'] as string[] | null) ?? [],
      lastReportedAt: String(row['last_reported_at']),
    }));
  }

  /**
   * Overrides and forfeits recorded during the event.
   *
   * `match_forfeits` has no event_id — the reach is
   * matches -> phases -> tournaments -> events, and a direct filter would 400
   * into an empty section that reads as "nothing was overridden".
   */
  private async loadOverrides(eventId: string): Promise<OverrideRow[]> {
    const { data, error } = await this.supabase.service
      .from('match_forfeits')
      .select('reason, voided_at, matches!inner(phases!inner(tournaments!inner(event_id)))')
      .eq('matches.phases.tournaments.event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      reason: (row['reason'] as string | null) ?? null,
      voided: row['voided_at'] != null,
    }));
  }

  private async loadArrivals(eventId: string): Promise<ArrivalRow[]> {
    const { data, error } = await this.supabase.service
      .from('event_arrivals')
      .select('via, reversed_at')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      via: String(row['via'] ?? 'unknown'),
      reversed: row['reversed_at'] != null,
    }));
  }

  /**
   * How many staff accounts the clock reconciliation would flag. The detail
   * report is not rebuilt here — it already exists with its own page, and a
   * second derivation would drift from it.
   */
  private async countFlaggedClocks(eventId: string): Promise<number> {
    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .select('clock_skew_ms')
      .eq('event_id', eventId)
      .not('clock_skew_ms', 'is', null);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<{ clock_skew_ms: number | null }>).filter(
      (row) => Math.abs(Number(row.clock_skew_ms ?? 0)) >= CLOCK_SKEW_REPORT_MS,
    ).length;
  }

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
