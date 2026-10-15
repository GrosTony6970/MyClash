/**
 * exports.service.ts — T-1004
 *
 * Generates CSV / JSON / HEMA Ratings format exports.
 *
 * The HEMA Ratings submission bundle is a zip of CSVs, shaped by
 * hema-ratings-submission.ts. This service only gathers the rows; every rule
 * about what HEMA Ratings will accept lives in that pure module.
 */

import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { allowsRatingsExport, asEventKind } from '@myclash/types';
import { FORFEIT_REASONS } from '@myclash/rulesets';
import { inListChunks, READ_PAGE } from '../../common/postgrest-in-list';
import { createStoredZip } from '../../common/stored-zip';
import { FULL_CSV_HEADER, fullCsvRow } from './full-event-csv';
import {
  buildSubmission,
  type SubmissionClub,
  type SubmissionFighter,
  type SubmissionInput,
  type SubmissionMatch,
  type SubmissionResult,
  type SubmissionTournament,
} from './hema-ratings-submission';
import {
  toSubmissionClub,
  toSubmissionFighter,
  toSubmissionMatch,
  type Row,
} from './hema-ratings-rows';
import { SupabaseService } from '../supabase/supabase.service';

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ExportsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── HEMA Ratings submission bundle ────────────────────────────────────────

  async generateHemaRatingsZip(eventId: string): Promise<{ filename: string; buffer: Buffer }> {
    const { slug, result } = await this.buildHemaRatingsSubmission(eventId);
    return {
      filename: `${slug}-hemaratings.zip`,
      buffer: createStoredZip(result.files),
    };
  }

  async previewHemaRatingsSubmission(eventId: string): Promise<{
    files: string[];
    counts: SubmissionResult['counts'];
    warnings: SubmissionResult['warnings'];
  }> {
    const { result } = await this.buildHemaRatingsSubmission(eventId);
    return {
      files: Object.keys(result.files),
      counts: result.counts,
      warnings: result.warnings,
    };
  }

  private async buildHemaRatingsSubmission(
    eventId: string,
  ): Promise<{ slug: string; result: SubmissionResult }> {
    const [event, tournaments] = await Promise.all([
      this.fetchOne('events', (q) => q.select('slug, event_kind').eq('id', eventId).maybeSingle()),
      this.fetchMany('tournaments', (q) =>
        q.select('id, name, sort_order').eq('event_id', eventId).order('sort_order'),
      ),
    ]);

    // HEMA Ratings is an external, public rating database: only standard events
    // belong in it. Test events are dry runs and club events are internal
    // activity — neither should reach a global rating pool. This is the single
    // choke point for both the zip download and the pre-flight preview.
    const kind = asEventKind(event?.['event_kind']);
    if (!allowsRatingsExport(kind)) {
      throw new BadRequestException(
        kind === 'club'
          ? 'Club events cannot be submitted to HEMA Ratings: their results do not count toward ratings.'
          : 'Test events cannot be submitted to HEMA Ratings: their results do not count toward ratings.',
      );
    }

    const slug = (event?.['slug'] as string | undefined) ?? eventId;
    const tournamentIds = tournaments.map((t) => t['id'] as string);
    if (tournamentIds.length === 0) {
      return { slug, result: buildSubmission({ clubs: [], fighters: [], tournaments: [] }) };
    }

    const input = await this.collectSubmissionInput(tournaments, tournamentIds);
    return { slug, result: buildSubmission(input) };
  }

  private async collectSubmissionInput(
    tournaments: Row[],
    tournamentIds: string[],
  ): Promise<SubmissionInput> {
    const [matchRows, forfeitedMatchIds] = await this.fetchMatches(tournamentIds);

    const matchesByTournament = new Map<string, SubmissionMatch[]>();
    const personIds = new Set<string>();
    for (const row of sortMatches(matchRows)) {
      const tournamentId = (row['phases'] as Row | null)?.['tournament_id'] as string | undefined;
      if (!tournamentId) continue;

      const match = toSubmissionMatch(row, forfeitedMatchIds);
      if (match.redPersonId) personIds.add(match.redPersonId);
      if (match.bluePersonId) personIds.add(match.bluePersonId);

      const list = matchesByTournament.get(tournamentId) ?? [];
      list.push(match);
      matchesByTournament.set(tournamentId, list);
    }

    const [fighters, clubs] = await this.fetchFightersAndClubs([...personIds]);

    const submissionTournaments: SubmissionTournament[] = tournaments.map((t) => ({
      id: t['id'] as string,
      name: (t['name'] as string | null) ?? '',
      matches: matchesByTournament.get(t['id'] as string) ?? [],
    }));

    return { clubs, fighters, tournaments: submissionTournaments };
  }

  /**
   * Completed matches for these tournaments, plus the set that was forfeited. Both are read page
   * by page: one read stops at 1000 rows with no word, and a big Event then sent HEMA Ratings a
   * short submission.
   */
  private async fetchMatches(tournamentIds: string[]): Promise<[Row[], Set<string>]> {
    // `matches` has NO tournament_id column — the only route from a match to a
    // tournament is phase_id → phases.tournament_id. Filtering on the embedded
    // column with !inner is what makes this work; a direct .eq('tournament_id')
    // 400s and (if the error is swallowed) yields a silently empty export.
    const [matchRows, forfeitRows] = await Promise.all([
      this.fetchAllByKey('matches', (q) =>
        q
          .select(
            `
            id, end_reason, winner_registration_id, match_number_label,
            red_registration_id, blue_registration_id,
            pools ( sort_order ),
            bracket_slots ( round ),
            swiss_rounds ( round_number ),
            phases!inner ( tournament_id, type, sort_order, config_json ),
            red_reg:registrations!red_registration_id ( id, person_id ),
            blue_reg:registrations!blue_registration_id ( id, person_id )
          `,
          )
          .in('phases.tournament_id', tournamentIds)
          .eq('status', 'completed'),
      ),
      // Fetched separately rather than embedded: match_forfeits carries its own
      // tournament_id, and an embed would be one more array-vs-object shape to
      // get wrong. Un-voided rows only.
      //
      // FORFEIT_REASONS, not every row: the table also holds result overrides,
      // and this set is what drops a match from the HEMA Ratings submission as
      // a walk-over. A corrected result is a real bout that was really fought
      // — excluding it would silently delete it from the fighters' ratings.
      this.fetchAllByKey('match_forfeits', (q) =>
        q
          .select('id, match_id')
          .in('tournament_id', tournamentIds)
          .in('reason', [...FORFEIT_REASONS])
          .is('voided_at', null),
      ),
    ]);

    return [matchRows, new Set(forfeitRows.map((row) => row['match_id'] as string))];
  }

  private async fetchFightersAndClubs(
    personIds: string[],
  ): Promise<[SubmissionFighter[], SubmissionClub[]]> {
    if (personIds.length === 0) return [[], []];

    // By pieces of ids: every Fighter's id in one URL outgrows the request line of a big Event.
    const personRows = await this.fetchByIds('persons', personIds, (q, ids) =>
      q
        .select(
          `id, given_name, family_name, club_id, hema_ratings_id, gender_category,
           global_persons ( country_code, hema_ratings_id )`,
        )
        .in('id', ids),
    );

    const clubIds = [
      ...new Set(
        personRows
          .map((row) => row['club_id'])
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const clubRows = await this.fetchByIds('clubs', clubIds, (q, ids) =>
      q.select('id, name, country_code, city, website').in('id', ids),
    );

    const clubs: SubmissionClub[] = clubRows.map(toSubmissionClub);
    const clubCountryById = new Map(clubs.map((club) => [club.id, club.countryCode]));
    const fighters = personRows.map((row) => toSubmissionFighter(row, clubCountryById));

    return [fighters, clubs];
  }

  // ── Generic CSV export (all matches + exchanges) ──────────────────────────

  async generateFullCsvRows(eventId: string): Promise<unknown[][]> {
    const exchanges = await this.fetchEventExchanges(eventId);
    return [FULL_CSV_HEADER, ...exchanges.map(fullCsvRow)];
  }

  /**
   * Every hit of this Event, in the order they were struck. Each embed on the way to the Event is
   * `!inner`: without it the nested filter only blanks the Tournament and keeps the row, so the
   * file held the hits of every Event. The hits are read page by page (`fetchAllByKey`), and the
   * file's order is then made here, by time and id.
   */
  private async fetchEventExchanges(eventId: string): Promise<Row[]> {
    const exchanges = await this.fetchAllByKey('exchanges', (q) =>
      q
        .select(
          `
          id, type, sequence, occurred_at, clock_time_ms,
          first_striker_color, first_strike_value, afterblow_value,
          no_exchange_reason, voided, voided_reason,
          matches!inner (
            id, match_number_label, status,
            red_registration_id, blue_registration_id,
            pools ( sort_order ),
            bracket_slots ( round ),
            swiss_rounds ( round_number ),
            phases!inner ( config_json, tournaments!inner ( name, slug, weapon ) )
          )
        `,
        )
        .eq('matches.phases.tournaments.event_id', eventId),
    );
    return exchanges.sort(byTimeThenId);
  }

  // ── JSON export ───────────────────────────────────────────────────────────

  async generateEventJson(eventId: string): Promise<object> {
    const [eventRes, tournamentsRes] = await Promise.all([
      this.supabase.service
        .from('events')
        .select('*, organizations ( name, slug )')
        .eq('id', eventId)
        .maybeSingle(),
      this.supabase.service
        .from('tournaments')
        .select(
          `
          *,
          phases (
            *,
            pools ( *, pool_members ( * ) ),
            matches (
              *,
              exchanges ( * )
            )
          )
        `,
        )
        .eq('event_id', eventId),
    ]);

    return {
      event: eventRes.data,
      tournaments: tournamentsRes.data ?? [],
      exportedAt: new Date().toISOString(),
      version: '1.0',
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Run a query and THROW on a PostgREST error instead of falling back to an
   * empty list. Selecting a column that does not exist 400s the whole query, so
   * a swallowed error is indistinguishable from "this event has no data" — the
   * export then downloads as an empty, plausible-looking file. Loud is better.
   */
  private async fetchMany(
    table: string,
    build: (query: QueryChain) => PromiseLike<QueryListResult>,
  ): Promise<Row[]> {
    const { data, error } = await build(this.chain(table));
    if (error) {
      throw new InternalServerErrorException(`Export query on "${table}" failed: ${error.message}`);
    }
    return data ?? [];
  }

  /**
   * Every row a read matches. One read is cut at 1000 rows with no word, so the rows are read page
   * by page BY KEY, each page after the last id, until a page comes back empty (`READ_PAGE`). The
   * race, named: an export runs while pads send hits and bouts end; by offset, a row landing
   * between two pages shifted another onto both. `build` selects `id` and sets the filters.
   */
  private async fetchAllByKey(table: string, build: (query: QueryChain) => QueryChain) {
    const rows: Row[] = [];
    for (;;) {
      const after = rows.at(-1)?.['id'];
      const page = await this.fetchMany(table, (q) => {
        const query = build(q).order('id').limit(READ_PAGE);
        return after === undefined ? query : query.gt('id', after);
      });
      if (page.length === 0) return rows;
      rows.push(...page);
    }
  }

  /** The rows of these ids, read by pieces of ids that fit in one request line (`IN_LIST_MAX`). */
  private async fetchByIds(
    table: string,
    ids: readonly string[],
    build: (query: QueryChain, ids: string[]) => PromiseLike<QueryListResult>,
  ): Promise<Row[]> {
    const pieces = await Promise.all(
      inListChunks([...new Set(ids)]).map((piece) => this.fetchMany(table, (q) => build(q, piece))),
    );
    return pieces.flat();
  }

  private async fetchOne(
    table: string,
    build: (query: QueryChain) => PromiseLike<QuerySingleResult>,
  ): Promise<Row | null> {
    const { data, error } = await build(this.chain(table));
    if (error) {
      throw new InternalServerErrorException(`Export query on "${table}" failed: ${error.message}`);
    }
    return data ?? null;
  }

  private chain(table: string): QueryChain {
    return this.supabase.service.from(table) as unknown as QueryChain;
  }
}

// ── Module helpers ────────────────────────────────────────────────────────────

type QueryError = { message: string } | null;
type QueryListResult = { data: Row[] | null; error: QueryError };
type QuerySingleResult = { data: Row | null; error: QueryError };

/** The slice of the PostgREST builder these exports use. */
type QueryChain = PromiseLike<QueryListResult> & {
  select: (columns: string) => QueryChain;
  eq: (column: string, value: unknown) => QueryChain;
  in: (column: string, values: unknown[]) => QueryChain;
  is: (column: string, value: unknown) => QueryChain;
  order: (column: string, options?: Record<string, unknown>) => QueryChain;
  gt: (column: string, value: unknown) => QueryChain;
  limit: (count: number) => QueryChain;
  maybeSingle: () => Promise<QuerySingleResult>;
};

/** The full CSV's order: the time a hit was struck, then its id. */
function byTimeThenId(a: Row, b: Row): number {
  const at = String(a['occurred_at']).localeCompare(String(b['occurred_at']));
  return at !== 0 ? at : String(a['id']).localeCompare(String(b['id']));
}

/** Phase order, then match label — so a re-export is byte-identical. */
function sortMatches(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const phaseA = (a['phases'] as Row | null)?.['sort_order'];
    const phaseB = (b['phases'] as Row | null)?.['sort_order'];
    const orderA = typeof phaseA === 'number' ? phaseA : 0;
    const orderB = typeof phaseB === 'number' ? phaseB : 0;
    if (orderA !== orderB) return orderA - orderB;
    const labelA = (a['match_number_label'] as string | null) ?? '';
    const labelB = (b['match_number_label'] as string | null) ?? '';
    return labelA.localeCompare(labelB, undefined, { numeric: true });
  });
}
