import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  MatchStatus,
  PhaseFilter,
  RankMetric,
  ToolResult,
  TournamentContext,
  TournamentToolContext,
} from './tournament-query.types';

type FighterRow = {
  tournament_id: string;
  event_id: string;
  registration_id: string;
  person_id: string;
  fighter_id?: string | null;
  display_name: string;
  club_name?: string | null;
  country_code?: string | null;
  weapon?: string | null;
  status: string;
  seed?: number | null;
  bib_number?: number | null;
};

type MatchRow = {
  tournament_id: string;
  event_id: string;
  match_id: string;
  phase_type: string;
  pool_id?: string | null;
  pool_name?: string | null;
  bracket_round?: number | null;
  bracket_position?: number | null;
  lice_id?: string | null;
  lice_name?: string | null;
  lice_number?: number | null;
  red_registration_id?: string | null;
  blue_registration_id?: string | null;
  red_name?: string | null;
  blue_name?: string | null;
  red_club?: string | null;
  blue_club?: string | null;
  scheduled_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_active_ms?: number | null;
  duration_total_ms?: number | null;
  red_score?: number | null;
  blue_score?: number | null;
  winner_registration_id?: string | null;
  status: string;
  match_number_label?: string | null;
};

type ExchangeSummaryRow = {
  tournament_id: string;
  match_id: string;
  doubles: number;
  afterblows: number;
};

type ProgrammeRow = {
  event_id: string;
  competition_id?: string | null;
  competition_phase?: string | null;
  label: string;
  start_time: string;
  end_time: string;
  match_duration_minutes?: number | null;
};

type RefereeRow = {
  tournament_id?: string | null;
  event_id: string;
  user_id: string;
  judge_name?: string | null;
  pool_id?: string | null;
  pool_name?: string | null;
  match_id?: string | null;
  role?: string | null;
  status: string;
};

@Injectable()
export class TournamentQueryToolsService {
  constructor(private readonly supabase: SupabaseService) {}

  async getToolContext(tournament: TournamentContext): Promise<TournamentToolContext> {
    const [tournaments, pools, lices] = await Promise.all([
      this.supabase.service
        .from('tournaments')
        .select('weapon, category')
        .eq('event_id', tournament.eventId),
      this.supabase.service
        .from('vw_tournament_query_pools')
        .select('pool_id')
        .eq('tournament_id', tournament.tournamentId),
      this.supabase.service.from('lices').select('sort_order').eq('event_id', tournament.eventId),
    ]);

    const weapons = unique(
      ((tournaments.data ?? []) as Array<{ weapon?: string | null }>)
        .map((row) => row.weapon)
        .filter(nonEmpty),
    );
    const divisions = unique(
      ((tournaments.data ?? []) as Array<{ category?: string | null }>)
        .map((row) => row.category)
        .filter(nonEmpty),
    );
    const poolIds = unique(
      ((pools.data ?? []) as Array<{ pool_id?: string | null }>)
        .map((row) => row.pool_id)
        .filter(nonEmpty),
    );
    const liceNumbers = unique(
      ((lices.data ?? []) as Array<{ sort_order?: number | null }>)
        .map((row) => (typeof row.sort_order === 'number' ? row.sort_order + 1 : null))
        .filter((value): value is number => typeof value === 'number'),
    );

    return {
      weapons: weapons.length > 0 ? weapons : tournament.weapon ? [tournament.weapon] : [],
      poolIds,
      liceNumbers,
      divisions:
        divisions.length > 0 ? divisions : tournament.category ? [tournament.category] : [],
    };
  }

  async execute(
    tournament: TournamentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    switch (toolName) {
      case 'find_fighters':
        return this.findFighters(tournament, args);
      case 'get_fighter_stats':
        return this.getFighterStats(tournament, args);
      case 'find_matches':
        return this.findMatches(tournament, args);
      case 'get_pool_standings':
        return this.getPoolStandings(tournament, args);
      case 'get_ring_status':
        return this.getRingStatus(tournament, args);
      case 'rank_fighters':
        return this.rankFighters(tournament, args);
      case 'get_judge_stats':
        return this.getJudgeStats(tournament, args);
      case 'compare_clubs':
        return this.compareClubs(tournament, args);
      case 'get_bracket_status':
        return this.getBracketStatus(tournament, args);
      case 'get_tournament_summary':
        return this.getTournamentSummary(tournament, args);
      case 'estimate_pool_completion':
        return this.estimatePoolCompletion(tournament, args);
      case 'get_schedule_status':
        return this.getScheduleStatus(tournament, args);
      case 'find_lagging_pools':
        return this.findLaggingPools(tournament, args);
      default:
        throw new BadRequestException(`Unsupported query tool: ${toolName}`);
    }
  }

  private async fighters(tournamentId: string): Promise<FighterRow[]> {
    const { data, error } = await this.supabase.service
      .from('vw_tournament_query_fighters')
      .select('*')
      .eq('tournament_id', tournamentId);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as FighterRow[];
  }

  private async matches(tournamentId: string): Promise<MatchRow[]> {
    const { data, error } = await this.supabase.service
      .from('vw_tournament_query_matches')
      .select('*')
      .eq('tournament_id', tournamentId);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as MatchRow[];
  }

  private async exchanges(tournamentId: string): Promise<ExchangeSummaryRow[]> {
    const { data, error } = await this.supabase.service
      .from('vw_tournament_query_exchange_summary')
      .select('*')
      .eq('tournament_id', tournamentId);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as ExchangeSummaryRow[];
  }

  private async programme(eventId: string, tournamentId: string): Promise<ProgrammeRow[]> {
    const { data, error } = await this.supabase.service
      .from('event_programme_blocks')
      .select(
        'event_id, competition_id, competition_phase, label, start_time, end_time, match_duration_minutes',
      )
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as ProgrammeRow[]).filter(
      (row) => !row.competition_id || row.competition_id === tournamentId,
    );
  }

  private async referees(tournament: TournamentContext): Promise<RefereeRow[]> {
    const { data, error } = await this.supabase.service
      .from('vw_tournament_query_referees')
      .select('*')
      .eq('event_id', tournament.eventId);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as RefereeRow[]).filter(
      (row) => !row.tournament_id || row.tournament_id === tournament.tournamentId,
    );
  }

  private async findFighters(tournament: TournamentContext, args: Record<string, unknown>) {
    const rows = (await this.fighters(tournament.tournamentId))
      .filter((fighter) => optionalContains(fighter.display_name, args['name_contains']))
      .filter((fighter) => optionalContains(fighter.club_name, args['club_name']))
      .filter((fighter) => optionalEquals(fighter.country_code, args['country']))
      .filter((fighter) => optionalEquals(fighter.weapon, args['weapon']))
      .filter((fighter) => this.matchesFighterStatus(fighter, args['status']))
      .slice(0, limit(args['limit'], 50, 200));

    if (rows.length === 0) return empty('No matching fighters', 'find_fighters', args);
    return {
      render_hint: 'list',
      title: 'Matching fighters',
      items: rows.map((fighter) => ({
        label: fighter.display_name,
        value:
          [fighter.club_name, fighter.country_code].filter(Boolean).join(' · ') || fighter.status,
      })),
      metadata: { tool_name: 'find_fighters', arguments: args, row_count: rows.length },
    } satisfies ToolResult;
  }

  private async getFighterStats(tournament: TournamentContext, args: Record<string, unknown>) {
    const fighterId = String(args['fighter_id']);
    const matches = filterPhase(await this.matches(tournament.tournamentId), args['phase']);
    const relevant = matches.filter(
      (match) =>
        match.red_registration_id === fighterId || match.blue_registration_id === fighterId,
    );
    const stats = this.computeStats(
      [fighterId],
      relevant,
      await this.exchanges(tournament.tournamentId),
    )[fighterId];
    if (!stats) return empty('No matches found for this fighter', 'get_fighter_stats', args);
    const fighterName =
      relevant.find((match) => match.red_registration_id === fighterId)?.red_name ??
      relevant.find((match) => match.blue_registration_id === fighterId)?.blue_name ??
      fighterId;
    return {
      render_hint: 'card',
      title: `Stats for ${fighterName}`,
      card: {
        Matches: stats.matches,
        Wins: stats.wins,
        Losses: stats.losses,
        Doubles: stats.doubles,
        Afterblows: stats.afterblows,
        'Win rate': percent(stats.winRate),
      },
      metadata: { tool_name: 'get_fighter_stats', arguments: args },
    } satisfies ToolResult;
  }

  private async findMatches(tournament: TournamentContext, args: Record<string, unknown>) {
    const rows = (await this.matches(tournament.tournamentId))
      .filter((match) => optionalEquals(match.lice_number, args['ring_number']))
      .filter((match) => optionalEquals(match.pool_id, args['pool_id']))
      .filter(
        (match) =>
          !args['fighter_id'] ||
          match.red_registration_id === args['fighter_id'] ||
          match.blue_registration_id === args['fighter_id'],
      )
      .filter((match) => this.matchesMatchStatus(match, args['status']))
      .slice(0, limit(args['limit'], 50, 200));

    if (rows.length === 0) return empty('No matching matches', 'find_matches', args);
    return table(
      'Matching matches',
      ['Match', 'Pool', 'Lice', 'Fighters', 'Status', 'Scheduled'],
      rows.map((match) => ({
        Match: match.match_number_label ?? match.match_id,
        Pool: match.pool_name ?? '',
        Lice: match.lice_name ?? '',
        Fighters: `${match.red_name ?? 'TBD'} vs ${match.blue_name ?? 'TBD'}`,
        Status: match.status,
        Scheduled: formatTime(match.scheduled_at),
      })),
      'find_matches',
      args,
    );
  }

  private async getPoolStandings(tournament: TournamentContext, args: Record<string, unknown>) {
    const matches = (await this.matches(tournament.tournamentId)).filter(
      (match) => match.phase_type === 'pool' && optionalEquals(match.pool_id, args['pool_id']),
    );
    if (matches.length === 0) return empty('No pool matches found', 'get_pool_standings', args);
    const ids = unique(
      matches
        .flatMap((match) => [match.red_registration_id, match.blue_registration_id])
        .filter(nonEmpty),
    );
    const stats = this.computeStats(ids, matches, await this.exchanges(tournament.tournamentId));
    const names = new Map<string, { name: string; club: string; pool: string }>();
    for (const match of matches) {
      if (match.red_registration_id)
        names.set(match.red_registration_id, {
          name: match.red_name ?? match.red_registration_id,
          club: match.red_club ?? '',
          pool: match.pool_name ?? '',
        });
      if (match.blue_registration_id)
        names.set(match.blue_registration_id, {
          name: match.blue_name ?? match.blue_registration_id,
          club: match.blue_club ?? '',
          pool: match.pool_name ?? '',
        });
    }
    const rows = ids
      .map((id) => ({ id, ...statOrZero(stats[id]), ...names.get(id) }))
      .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)
      .map((row, index) => ({
        Rank: index + 1,
        Pool: row.pool ?? '',
        Fighter: row.name ?? row.id,
        Club: row.club ?? '',
        Wins: row.wins,
        Losses: row.losses,
        Points: row.pointsFor,
      }));
    return table(
      'Pool standings',
      ['Rank', 'Pool', 'Fighter', 'Club', 'Wins', 'Losses', 'Points'],
      rows,
      'get_pool_standings',
      args,
    );
  }

  private async getRingStatus(tournament: TournamentContext, args: Record<string, unknown>) {
    const matches = (await this.matches(tournament.tournamentId)).filter((match) =>
      optionalEquals(match.lice_number, args['ring_number']),
    );
    const byLice = groupBy(
      matches.filter((match) => match.lice_number),
      (match) => String(match.lice_number),
    );
    const rows = Object.entries(byLice)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([lice, liceMatches]) => {
        const current = liceMatches.find((match) => ['running', 'paused'].includes(match.status));
        const queue = liceMatches.filter((match) => match.status === 'scheduled').length;
        const nextScheduled = liceMatches.find(
          (match) => match.status === 'scheduled',
        )?.scheduled_at;
        return {
          Lice: Number(lice),
          'Current match': current
            ? `${current.red_name ?? 'TBD'} vs ${current.blue_name ?? 'TBD'}`
            : '',
          Queue: queue,
          Schedule: scheduleLabel(nextScheduled),
        };
      });
    if (rows.length === 0) return empty('No lices have scheduled matches', 'get_ring_status', args);
    return table(
      'Lice status',
      ['Lice', 'Current match', 'Queue', 'Schedule'],
      rows,
      'get_ring_status',
      args,
    );
  }

  private async rankFighters(tournament: TournamentContext, args: Record<string, unknown>) {
    const fighters = await this.fighters(tournament.tournamentId);
    const matches = filterPhase(await this.matches(tournament.tournamentId), args['phase']);
    const stats = this.computeStats(
      fighters.map((fighter) => fighter.registration_id),
      matches,
      await this.exchanges(tournament.tournamentId),
    );
    const metric = (args['metric'] as RankMetric) ?? 'wins';
    const minMatches = typeof args['min_matches'] === 'number' ? args['min_matches'] : 3;
    const order = args['order'] === 'asc' ? 'asc' : 'desc';
    const rows = fighters
      .map((fighter) => ({ fighter, stats: stats[fighter.registration_id] }))
      .filter((row): row is { fighter: FighterRow; stats: ReturnType<typeof zeroStats> } =>
        Boolean(row.stats && row.stats.matches >= minMatches),
      )
      .sort((a, b) => {
        const delta = metricValue(a.stats, metric) - metricValue(b.stats, metric);
        return order === 'asc' ? delta : -delta;
      })
      .slice(0, limit(args['limit'], 10, 50))
      .map((row, index) => ({
        Rank: index + 1,
        Fighter: row.fighter.display_name,
        Club: row.fighter.club_name ?? '',
        Matches: row.stats.matches,
        Wins: row.stats.wins,
        [labelForMetric(metric)]: formatMetric(row.stats, metric),
      }));
    if (rows.length === 0) {
      return empty('No fighters match the ranking criteria', 'rank_fighters', args, [
        `Min ${minMatches} matches required for ranking eligibility`,
      ]);
    }
    return table(
      `Top fighters by ${metric.replace(/_/g, ' ')}`,
      ['Rank', 'Fighter', 'Club', 'Matches', 'Wins', labelForMetric(metric)],
      rows,
      'rank_fighters',
      args,
      [`Min ${minMatches} matches required for ranking eligibility`],
    );
  }

  private async getJudgeStats(tournament: TournamentContext, args: Record<string, unknown>) {
    const judgeId = String(args['judge_id']);
    const refs = (await this.referees(tournament)).filter((row) => row.user_id === judgeId);
    if (refs.length === 0) return empty('No judge assignments found', 'get_judge_stats', args);
    return {
      render_hint: 'card',
      title: `Judge stats for ${refs[0]?.judge_name ?? judgeId}`,
      card: {
        Assignments: refs.length,
        Pools: unique(refs.map((row) => row.pool_id).filter(nonEmpty)).length,
        Matches: unique(refs.map((row) => row.match_id).filter(nonEmpty)).length,
      },
      metadata: { tool_name: 'get_judge_stats', arguments: args },
    } satisfies ToolResult;
  }

  private async compareClubs(tournament: TournamentContext, args: Record<string, unknown>) {
    const clubNames = Array.isArray(args['club_names'])
      ? args['club_names'].filter((club): club is string => typeof club === 'string').slice(0, 5)
      : [];
    const fighters = (await this.fighters(tournament.tournamentId)).filter((fighter) =>
      clubNames.some((club) => contains(fighter.club_name, club)),
    );
    if (fighters.length === 0) return empty('No matching clubs found', 'compare_clubs', args);
    const stats = this.computeStats(
      fighters.map((fighter) => fighter.registration_id),
      await this.matches(tournament.tournamentId),
      await this.exchanges(tournament.tournamentId),
    );
    const entities = unique(fighters.map((fighter) => fighter.club_name ?? 'Unknown'));
    const metrics: Record<string, Array<string | number>> = {
      Fighters: [],
      Wins: [],
      'Win rate': [],
    };
    for (const club of entities) {
      const clubFighters = fighters.filter((fighter) => fighter.club_name === club);
      const totals = clubFighters.reduce(
        (acc, fighter) => addStats(acc, stats[fighter.registration_id]),
        zeroStats(),
      );
      metrics['Fighters']!.push(clubFighters.length);
      metrics['Wins']!.push(totals.wins);
      metrics['Win rate']!.push(percent(totals.winRate));
    }
    return {
      render_hint: 'comparison',
      title: 'Club comparison',
      comparison: { entities, metrics },
      metadata: { tool_name: 'compare_clubs', arguments: args, row_count: entities.length },
    } satisfies ToolResult;
  }

  private async getBracketStatus(tournament: TournamentContext, args: Record<string, unknown>) {
    const rows = (await this.matches(tournament.tournamentId)).filter((match) =>
      ['single_elim', 'double_elim'].includes(match.phase_type),
    );
    if (rows.length === 0) return empty('No bracket matches found', 'get_bracket_status', args);
    return table(
      'Bracket status',
      ['Round', 'Match', 'Fighters', 'Status', 'Winner'],
      rows.map((match) => ({
        Round: match.bracket_round ?? '',
        Match: match.bracket_position ?? match.match_number_label ?? match.match_id,
        Fighters: `${match.red_name ?? 'TBD'} vs ${match.blue_name ?? 'TBD'}`,
        Status: match.status,
        Winner:
          match.winner_registration_id === match.red_registration_id
            ? (match.red_name ?? '')
            : match.winner_registration_id === match.blue_registration_id
              ? (match.blue_name ?? '')
              : '',
      })),
      'get_bracket_status',
      args,
    );
  }

  private async getTournamentSummary(tournament: TournamentContext, args: Record<string, unknown>) {
    const [fighters, matches, exchanges] = await Promise.all([
      this.fighters(tournament.tournamentId),
      this.matches(tournament.tournamentId),
      this.exchanges(tournament.tournamentId),
    ]);
    const completed = matches.filter((match) => match.status === 'completed');
    return {
      render_hint: 'summary_stats',
      title: 'Tournament summary',
      items: [
        { label: 'Fighters', value: fighters.length },
        { label: 'Matches', value: matches.length },
        { label: 'Completed matches', value: completed.length },
        {
          label: 'Doubles',
          value: exchanges.reduce((sum, row) => sum + Number(row.doubles ?? 0), 0),
        },
      ],
      metadata: { tool_name: 'get_tournament_summary', arguments: args },
    } satisfies ToolResult;
  }

  private async estimatePoolCompletion(
    tournament: TournamentContext,
    args: Record<string, unknown>,
  ) {
    const matches = (await this.matches(tournament.tournamentId)).filter(
      (match) => match.phase_type === 'pool' && optionalEquals(match.pool_id, args['pool_id']),
    );
    if (matches.length === 0)
      return empty('No active pool matches found', 'estimate_pool_completion', args);
    const byPool = groupBy(matches, (match) => match.pool_name ?? match.pool_id ?? 'Pool');
    const rows = Object.entries(byPool).map(([pool, poolMatches]) => {
      const complete = poolMatches.filter((match) => match.status === 'completed');
      const remaining = poolMatches.length - complete.length;
      const avgMs = average(
        complete
          .map((match) => match.duration_active_ms ?? match.duration_total_ms ?? 0)
          .filter(Boolean),
      );
      return {
        Pool: pool,
        Completed: complete.length,
        Remaining: remaining,
        'Average duration': avgMs ? formatDuration(avgMs) : 'n/a',
        'Projected finish': avgMs ? formatProjectedFinish(avgMs * remaining) : 'n/a',
      };
    });
    const notes =
      matches.filter((match) => match.status === 'completed').length < 3
        ? ['Estimate based on fewer than 3 completed matches - accuracy improves after ~5 matches']
        : [];
    return table(
      'Pool completion estimate',
      ['Pool', 'Completed', 'Remaining', 'Average duration', 'Projected finish'],
      rows,
      'estimate_pool_completion',
      args,
      notes,
    );
  }

  private async getScheduleStatus(tournament: TournamentContext, args: Record<string, unknown>) {
    const programme = await this.programme(tournament.eventId, tournament.tournamentId);
    if (programme.length === 0) {
      return empty(
        'No planned schedule is configured for this tournament',
        'get_schedule_status',
        args,
      );
    }
    const matches = await this.matches(tournament.tournamentId);
    const completed = matches.filter((match) => match.status === 'completed').length;
    const remaining = matches.length - completed;
    const avgMs = average(
      matches
        .filter((match) => match.status === 'completed')
        .map((match) => match.duration_active_ms ?? match.duration_total_ms ?? 0)
        .filter(Boolean)
        .slice(-30),
    );
    return {
      render_hint: 'card',
      title: 'Tournament schedule status',
      card: {
        Status: remaining === 0 ? 'Complete' : 'In progress',
        'Programme blocks': programme.length,
        'Matches completed': completed,
        'Matches remaining': remaining,
        'Average match duration': avgMs ? formatDuration(avgMs) : 'n/a',
      },
      metadata: {
        tool_name: 'get_schedule_status',
        arguments: args,
        notes: ['Average match duration computed over the last 30 completed matches'],
      },
    } satisfies ToolResult;
  }

  private async findLaggingPools(tournament: TournamentContext, args: Record<string, unknown>) {
    const programme = await this.programme(tournament.eventId, tournament.tournamentId);
    if (programme.length === 0) {
      return empty(
        'No planned schedule is configured for this tournament',
        'find_lagging_pools',
        args,
      );
    }
    const threshold =
      typeof args['threshold_minutes'] === 'number' ? args['threshold_minutes'] : 10;
    const matches = (await this.matches(tournament.tournamentId)).filter(
      (match) => match.phase_type === 'pool',
    );
    const refs = await this.referees(tournament);
    const rows = Object.entries(
      groupBy(matches, (match) => match.pool_name ?? match.pool_id ?? 'Pool'),
    )
      .map(([pool, poolMatches]) => {
        const remaining = poolMatches.filter((match) => match.status !== 'completed').length;
        const avgMs = average(
          poolMatches
            .filter((match) => match.status === 'completed')
            .map((match) => match.duration_active_ms ?? match.duration_total_ms ?? 0)
            .filter(Boolean),
        );
        const lag = avgMs ? Math.round((remaining * avgMs) / 60000) : 0;
        const poolReferees = unique(
          refs
            .filter((ref) => ref.pool_name === pool)
            .map((ref) => ref.judge_name ?? ref.user_id)
            .filter(nonEmpty),
        );
        return {
          Pool: pool,
          Weapon: tournament.weapon ?? '',
          Lag: `+${lag} min`,
          Referees: poolReferees.join(', '),
        };
      })
      .filter((row) => parseInt(String(row.Lag).replace(/\D/g, ''), 10) >= threshold);
    if (rows.length === 0)
      return empty('No pools are currently above the lag threshold', 'find_lagging_pools', args);
    return table(
      'Pools running behind',
      ['Pool', 'Weapon', 'Lag', 'Referees'],
      rows,
      'find_lagging_pools',
      args,
    );
  }

  private computeStats(
    registrationIds: string[],
    matches: MatchRow[],
    exchanges: ExchangeSummaryRow[],
  ): Record<string, ReturnType<typeof zeroStats>> {
    const byMatch = new Map(exchanges.map((row) => [row.match_id, row]));
    const stats = Object.fromEntries(registrationIds.map((id) => [id, zeroStats()]));
    for (const match of matches.filter((row) => row.status === 'completed')) {
      const exchange = byMatch.get(match.match_id);
      for (const color of ['red', 'blue'] as const) {
        const id = color === 'red' ? match.red_registration_id : match.blue_registration_id;
        if (!id || !stats[id]) continue;
        const ownScore =
          color === 'red' ? Number(match.red_score ?? 0) : Number(match.blue_score ?? 0);
        const otherScore =
          color === 'red' ? Number(match.blue_score ?? 0) : Number(match.red_score ?? 0);
        stats[id].matches += 1;
        stats[id].wins += match.winner_registration_id === id ? 1 : 0;
        stats[id].losses +=
          match.winner_registration_id && match.winner_registration_id !== id ? 1 : 0;
        stats[id].pointsFor += ownScore;
        stats[id].pointsAgainst += otherScore;
        stats[id].doubles += Number(exchange?.doubles ?? 0);
        stats[id].afterblows += Number(exchange?.afterblows ?? 0);
      }
    }
    for (const value of Object.values(stats)) {
      value.winRate = value.matches > 0 ? value.wins / value.matches : 0;
      value.doublesRate = value.matches > 0 ? value.doubles / value.matches : 0;
      value.afterblowRate = value.matches > 0 ? value.afterblows / value.matches : 0;
    }
    return stats;
  }

  private matchesFighterStatus(fighter: FighterRow, status: unknown) {
    if (!status || status === 'any') return true;
    if (status === 'active') return !['withdrawn', 'disqualified'].includes(fighter.status);
    if (status === 'eliminated') return ['withdrawn', 'disqualified'].includes(fighter.status);
    return true;
  }

  private matchesMatchStatus(match: MatchRow, status: unknown) {
    const filter = (status ?? 'any') as MatchStatus;
    if (filter === 'any') return true;
    if (filter === 'pending') return match.status === 'scheduled';
    if (filter === 'in_progress') return ['running', 'paused'].includes(match.status);
    if (filter === 'complete') return match.status === 'completed';
    return true;
  }
}

function table(
  title: string,
  columns: string[],
  rows: Array<Record<string, string | number>>,
  toolName: string,
  args: Record<string, unknown>,
  notes?: string[],
): ToolResult {
  return {
    render_hint: 'table',
    title,
    columns,
    rows,
    metadata: { tool_name: toolName, arguments: args, row_count: rows.length, notes },
  };
}

function empty(
  note: string,
  toolName: string,
  args: Record<string, unknown>,
  notes: string[] = [],
): ToolResult {
  return {
    render_hint: 'empty',
    title: 'No results',
    metadata: { tool_name: toolName, arguments: args, row_count: 0, notes: [note, ...notes] },
  };
}

function zeroStats() {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    doubles: 0,
    afterblows: 0,
    winRate: 0,
    doublesRate: 0,
    afterblowRate: 0,
  };
}

function statOrZero(stats: ReturnType<typeof zeroStats> | undefined) {
  return stats ?? zeroStats();
}

function addStats(target: ReturnType<typeof zeroStats>, source?: ReturnType<typeof zeroStats>) {
  if (!source) return target;
  target.matches += source.matches;
  target.wins += source.wins;
  target.losses += source.losses;
  target.pointsFor += source.pointsFor;
  target.pointsAgainst += source.pointsAgainst;
  target.doubles += source.doubles;
  target.afterblows += source.afterblows;
  target.winRate = target.matches > 0 ? target.wins / target.matches : 0;
  return target;
}

function metricValue(stats: ReturnType<typeof zeroStats>, metric: RankMetric) {
  if (metric === 'wins') return stats.wins;
  if (metric === 'win_rate') return stats.winRate;
  if (metric === 'doubles_rate') return stats.doublesRate;
  if (metric === 'afterblow_rate') return stats.afterblowRate;
  return stats.matches;
}

function labelForMetric(metric: RankMetric) {
  if (metric === 'win_rate') return 'Win rate';
  if (metric === 'doubles_rate') return 'Doubles rate';
  if (metric === 'afterblow_rate') return 'Afterblow rate';
  if (metric === 'matches_played') return 'Matches';
  return 'Wins';
}

function formatMetric(stats: ReturnType<typeof zeroStats>, metric: RankMetric) {
  if (metric.endsWith('_rate')) return percent(metricValue(stats, metric));
  return metricValue(stats, metric);
}

function filterPhase(matches: MatchRow[], phase: unknown) {
  const selected = (phase ?? 'all') as PhaseFilter;
  if (selected === 'pools') return matches.filter((match) => match.phase_type === 'pool');
  if (selected === 'elimination')
    return matches.filter((match) => ['single_elim', 'double_elim'].includes(match.phase_type));
  return matches;
}

function optionalContains(value: string | null | undefined, filter: unknown) {
  return !filter || contains(value, String(filter));
}

function contains(value: string | null | undefined, filter: string) {
  return (value ?? '').toLocaleLowerCase().includes(filter.toLocaleLowerCase());
}

function optionalEquals(value: unknown, filter: unknown) {
  return filter === undefined || filter === null || filter === '' || value === filter;
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function limit(value: unknown, fallback: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(max, Math.floor(value)))
    : fallback;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function formatProjectedFinish(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '';
}

function scheduleLabel(nextScheduled: string | null | undefined) {
  if (!nextScheduled) return 'no schedule';
  const delta = Math.round((Date.now() - new Date(nextScheduled).getTime()) / 60000);
  if (Math.abs(delta) < 5) return 'on time';
  return delta > 0 ? `behind ${delta} min` : `ahead ${Math.abs(delta)} min`;
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const group = key(item);
    acc[group] ??= [];
    acc[group].push(item);
    return acc;
  }, {});
}
