import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { matchSummaries } from '../matches/match-summaries';
import { PoolStandingsService } from '../pool-standings/pool-standings.service';
import { poolTableRows } from '../pool-standings/pool-table-rows';
import { isDoubleLossBout } from '@myclash/rulesets';
import { unknownFighterInEnglish, unknownRefereeInEnglish } from '../../common/unknown-name';
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
  /** `matches.end_reason` — 'max_doubles' means BOTH fighters LOST (0193). */
  end_reason?: string | null;
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
};

type RefereeRow = {
  tournament_id?: string | null;
  event_id: string;
  // A global_persons id, not an auth uid. 0063 replaced the view's user_id
  // projection with person_id; this type kept the old name, and because the
  // query is select('*') nothing errored — the field was simply undefined.
  person_id: string;
  judge_name?: string | null;
  pool_id?: string | null;
  pool_name?: string | null;
  match_id?: string | null;
  role?: string | null;
  status: string;
};

@Injectable()
export class TournamentQueryToolsService {
  private readonly logger = new Logger(TournamentQueryToolsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly poolStandings: PoolStandingsService,
  ) {}

  async getToolContext(tournament: TournamentContext): Promise<TournamentToolContext> {
    const [tournaments, pools, lices] = await Promise.all([
      this.supabase.service.from('tournaments').select('weapon').eq('event_id', tournament.eventId),
      this.supabase.service
        .from('vw_tournament_query_pools')
        .select('pool_name')
        .eq('tournament_id', tournament.tournamentId),
      this.supabase.service.from('lices').select('sort_order').eq('event_id', tournament.eventId),
    ]);

    const weapons = unique(
      ((tournaments.data ?? []) as Array<{ weapon?: string | null }>)
        .map((row) => row.weapon)
        .filter(nonEmpty),
    );
    const poolNames = unique(
      ((pools.data ?? []) as Array<{ pool_name?: string | null }>)
        .map((row) => row.pool_name)
        .filter(nonEmpty),
    );
    const liceNumbers = unique(
      ((lices.data ?? []) as Array<{ sort_order?: number | null }>)
        .map((row) => (typeof row.sort_order === 'number' ? row.sort_order + 1 : null))
        .filter((value): value is number => typeof value === 'number'),
    );

    return {
      weapons: weapons.length > 0 ? weapons : tournament.weapon ? [tournament.weapon] : [],
      poolNames,
      liceNumbers,
      divisions: [],
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

  /**
   * The tournament's fighters whose name contains the text, case-insensitive. A name that is
   * exactly the text wins over longer names that merely contain it ("Grace Hopper" vs
   * "Grace Hopperton"); two fighters with that same exact name stay a list.
   */
  private async fightersNamed(tournamentId: string, text: unknown): Promise<FighterRow[]> {
    const wanted = String(text ?? '').trim();
    if (!wanted) return [];
    return namedBest(await this.fighters(tournamentId), (fighter) => fighter.display_name, wanted);
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
      .select('event_id, competition_id, competition_phase, label, start_time, end_time')
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
    const named = await this.fightersNamed(tournament.tournamentId, args['fighter']);
    if (named.length === 0) {
      return empty('No matches found for this fighter', 'get_fighter_stats', args);
    }
    if (named.length > 1) return severalFighters(named, args['fighter'], 'get_fighter_stats', args);
    const fighterId = named[0]!.registration_id;
    const matches = filterPhase(await this.matches(tournament.tournamentId), args['phase']);
    const relevant = matches.filter(
      (match) =>
        match.red_registration_id === fighterId || match.blue_registration_id === fighterId,
    );
    const stats = this.computeStats(
      [fighterId],
      relevant,
      await this.exchanges(tournament.tournamentId),
    )[fighterId]!; // computeStats seeds every id it is given, so a fighter with no bouts reads zeros.
    return {
      render_hint: 'card',
      // The fighter just found, not a name read off the bouts: with no bouts there is none.
      title: `Stats for ${named[0]!.display_name}`,
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
    let fighterId: string | undefined;
    if (args['fighter']) {
      const named = await this.fightersNamed(tournament.tournamentId, args['fighter']);
      if (named.length === 0) return empty('No matching matches', 'find_matches', args);
      if (named.length > 1) return severalFighters(named, args['fighter'], 'find_matches', args);
      fighterId = named[0]!.registration_id;
    }
    const rows = (await this.matches(tournament.tournamentId))
      .filter((match) => optionalEquals(match.lice_number, args['ring_number']))
      .filter((match) => optionalEquals(match.pool_name, args['pool']))
      .filter(
        (match) =>
          !fighterId ||
          match.red_registration_id === fighterId ||
          match.blue_registration_id === fighterId,
      )
      .filter((match) => this.matchesMatchStatus(match, args['status']))
      .slice(0, limit(args['limit'], 50, 200));

    if (rows.length === 0) return empty('No matching matches', 'find_matches', args);
    const codes = await this.codesOf(rows.map((match) => match.match_id));
    return table(
      'Matching matches',
      ['Match', 'Pool', 'Lice', 'Fighters', 'Status', 'Scheduled'],
      rows.map((match) => ({
        Match: codes.get(match.match_id) ?? match.match_number_label ?? '',
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

  /**
   * Each bout's code (`LSW-P4-M01`), never its stored label, from the one builder of a
   * bout's name. Naming must not cost the answer: a failed read is logged, and the bouts
   * keep their stored labels.
   */
  private async codesOf(matchIds: string[]): Promise<Map<string, string>> {
    try {
      const summaries = await matchSummaries(this.supabase.service, matchIds);
      return new Map([...summaries].map(([id, summary]) => [id, summary.roundCode]));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`The codes of ${matchIds.length} bout(s) were not read: ${why}`);
      return new Map();
    }
  }

  private async getPoolStandings(tournament: TournamentContext, args: Record<string, unknown>) {
    // The public Tournament page's table: the ruleset's columns and ranking, not our own count.
    // The `weapon` argument is ignored: a Tournament has one weapon.
    const standings = await this.poolStandings.getPoolStandings(tournament.tournamentId, 'by-pool');
    if (!('pools' in standings)) return empty(NO_POOLS, 'get_pool_standings', args);
    const pools = poolTableRows(standings).filter((pool) =>
      optionalEquals(pool.name, args['pool']),
    );
    if (pools.length === 0) return empty(NO_POOLS, 'get_pool_standings', args);
    const labels = standings.columns.map((column) => column.label);
    const rows = pools.flatMap((pool) =>
      pool.rows.map((row) => ({
        Rank: row.rank,
        Pool: pool.name,
        // A person nobody named reads '' in the standings: worded here.
        Fighter: row.name || unknownFighterInEnglish(),
        Club: row.club ?? '',
        ...row.stats,
      })),
    );
    return table(
      'Pool standings',
      ['Rank', 'Pool', 'Fighter', 'Club', ...labels],
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
    const judge = String(args['judge'] ?? '').trim();
    // Matched on the name only: judge_name is the one judge identity any tool puts in front of
    // the model (find_lagging_pools lists referees by name), and no output shows an id. The rows
    // are grouped by person (person_id, never shown) and narrowed by the same rule as fighters:
    // one person only, else a list.
    const people = judge ? refereePeople(await this.referees(tournament)) : [];
    const named = namedBest(people, (person) => person.name, judge);
    if (named.length === 0) return empty('No judge assignments found', 'get_judge_stats', args);
    if (named.length > 1) {
      return severalPeople(
        'referees',
        named.map((person) => ({ label: person.name, value: 'referee' })),
        judge,
        'get_judge_stats',
        args,
      );
    }
    const refs = named[0]!.rows;
    return {
      render_hint: 'card',
      // A name matched the text, so it is never blank.
      title: `Judge stats for ${named[0]!.name}`,
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
        Match: match.bracket_position ?? match.match_number_label ?? '',
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
      (match) => match.phase_type === 'pool' && optionalEquals(match.pool_name, args['pool']),
    );
    if (matches.length === 0)
      return empty('No active pool matches found', 'estimate_pool_completion', args);
    const byPool = groupBy(matches, (match) => match.pool_name ?? 'Pool');
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
    const rows = Object.entries(groupBy(matches, (match) => match.pool_name ?? 'Pool'))
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
            .map((ref) => ref.judge_name || unknownRefereeInEnglish())
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
        // A ceiling double loss has no winner, so the two tests below credited
        // neither side — the bout counted toward `matches` and deflated the win
        // rate the organiser is shown and the assistant reasons from.
        const doubleLoss = isDoubleLossBout(match.end_reason ?? null);
        stats[id].wins += !doubleLoss && match.winner_registration_id === id ? 1 : 0;
        stats[id].losses +=
          doubleLoss || (match.winner_registration_id && match.winner_registration_id !== id)
            ? 1
            : 0;
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

const NO_POOLS = 'No pool matches found';

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

/**
 * The items whose name contains the text, case-insensitive. A name that is exactly the text wins
 * over longer names that merely contain it ("Grace Hopper" vs "Grace Hopperton"); two with that
 * same exact name stay a list. The one owner of this rule, for fighters and referees.
 */
function namedBest<T>(items: T[], nameOf: (item: T) => string | null | undefined, text: string) {
  const wanted = text.trim();
  if (!wanted) return [];
  const found = items.filter((item) => contains(nameOf(item), wanted));
  const exact = found.filter(
    (item) => (nameOf(item) ?? '').trim().toLocaleLowerCase() === wanted.toLocaleLowerCase(),
  );
  return exact.length > 0 ? exact : found;
}

/** The referee rows of each person, in order of first appearance. The person id is never shown. */
function refereePeople(rows: RefereeRow[]): Array<{ name: string; rows: RefereeRow[] }> {
  const byPerson = new Map<string, { name: string; rows: RefereeRow[] }>();
  for (const row of rows) {
    const person = byPerson.get(row.person_id);
    if (person) person.rows.push(row);
    else byPerson.set(row.person_id, { name: row.judge_name ?? '', rows: [row] });
  }
  return [...byPerson.values()];
}

/** Several people answer to the text: name each one (never an id) so the model can ask again. */
function severalPeople(
  noun: 'fighters' | 'referees',
  people: Array<{ label: string; value: string }>,
  text: unknown,
  toolName: string,
  args: Record<string, unknown>,
): ToolResult {
  return {
    render_hint: 'list',
    title: `Several ${noun} match "${String(text).trim()}"`,
    items: people,
    metadata: {
      tool_name: toolName,
      arguments: args,
      row_count: people.length,
      notes: ['Ask again with a more precise name'],
    },
  };
}

function severalFighters(
  fighters: FighterRow[],
  text: unknown,
  toolName: string,
  args: Record<string, unknown>,
): ToolResult {
  return severalPeople(
    'fighters',
    fighters.map((fighter) => ({
      label: fighter.display_name,
      value: fighter.club_name || fighter.status,
    })),
    text,
    toolName,
    args,
  );
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
