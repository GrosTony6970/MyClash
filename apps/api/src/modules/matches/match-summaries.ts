/**
 * The header summary of a bout: names, clubs, Pool, round code, piste, referees,
 * and the state of its rounds.
 *
 * ONE builder for one bout and for many. `GET /matches/:id/summary` asks it for
 * one id; the pad's read of a whole piste asks it for every bout of the piste
 * (`GET /staff/lices/:liceId/bouts`). It was eight single-row reads per bout;
 * sixty bouts through that would be about five hundred reads. Here each table is
 * read once per group of ids, whatever the number of bouts.
 *
 * Plain functions over the database client, with no Nest provider: the staff
 * module calls this too and does not import the matches module.
 */

import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bracketToken } from '@myclash/types';
import { getEffectiveBestOf, normalizeMatchFormatConfig } from '@myclash/rulesets';
import type { Match as RulesetMatch, Ruleset } from '@myclash/rulesets';
import { isOver } from '../../common/live-status';
import { asRow, boutEngineOf } from './bout-rules';
import type { RulesetResolver } from './ruleset-resolver.service';
import { scoredMatchFormat } from './scored-match-format';
import { buildRoundCode, bracketCodeConfig } from './round-code.helper';
import { fetchRefereeAssignmentIndex } from './referee-assignment-index';
import {
  refereeNamesOnly,
  resolveMatchReferees,
  type RefereeAssignmentRow,
} from './resolve-match-referees';

type Row = Record<string, unknown>;

const VIEW_SELECT =
  'match_id, match_number_label, status, pool_id, pool_name, bracket_round, swiss_round, red_name, blue_name, red_club, blue_club, tournament_id, event_id, phase_id, phase_type';

/** `lice_id` is on the bout's row, not on the view; so is its copy of its rules (its format). */
const ROUND_SELECT =
  'id, lice_id, current_round, red_round_wins, blue_round_wins, rounds_json, awaiting_round_advance, ' +
  'match_rules(ruleset_code, ruleset_version, ruleset_config)';

/** Ids per read: a longer `in.(…)` list makes an address some proxies refuse. */
const IDS_PER_READ = 100;
const logger = new Logger('MatchSummaries');

interface ViewRow {
  match_id: string;
  match_number_label: string | null;
  status: string;
  pool_id: string | null;
  pool_name: string | null;
  bracket_round: number | null;
  swiss_round: number | null;
  red_name: string | null;
  blue_name: string | null;
  red_club: string | null;
  blue_club: string | null;
  tournament_id: string;
  event_id: string;
  phase_id: string | null;
  phase_type: string | null;
}

/** What the other tables say, keyed by their id. */
interface SummaryContext {
  tournaments: Map<string, Row>;
  phases: Map<string, Row>;
  pools: Map<string, Row>;
  events: Map<string, Row>;
  bouts: Map<string, Row>;
  lices: Map<string, Row>;
  referees: Map<string, RefereeAssignmentRow[]>;
  /** The ruleset each bout's copy names, by bout id: none for a bout whose ruleset is not read. */
  rulesets: Map<string, Ruleset>;
}

export type MatchSummary = ReturnType<typeof summaryOf>;

/**
 * The rows of `table` whose `column` is one of `ids`, by `key`.
 *
 * A read that fails throws: a summary built without its Tournament would name
 * no weapon and no rounds, and the tablet would keep that as the bout.
 */
async function rowsById(
  db: SupabaseClient,
  read: { table: string; select: string; column: string; key: string },
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, Row>> {
  const wanted = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  const found = new Map<string, Row>();
  for (let from = 0; from < wanted.length; from += IDS_PER_READ) {
    const { data, error } = await db
      .from(read.table)
      .select(read.select)
      .in(read.column, wanted.slice(from, from + IDS_PER_READ));
    if (error) throw new Error(`${read.table}: ${error.message}`);
    for (const row of (data ?? []) as unknown as Row[]) found.set(row[read.key] as string, row);
  }
  return found;
}

const byId = (table: string, select: string) => ({ table, select, column: 'id', key: 'id' });

async function contextOf(
  db: SupabaseClient,
  views: ViewRow[],
  resolver: RulesetResolver | null,
): Promise<SummaryContext> {
  const bouts = await rowsById(
    db,
    byId('matches', ROUND_SELECT),
    views.map((row) => row.match_id),
  );
  const rulesets = new Map<string, Ruleset>();
  for (const [id, bout] of bouts) {
    const ruleset = resolver && (await shownRulesetOf(id, bout, resolver));
    if (ruleset) rulesets.set(id, ruleset);
  }
  const eventIds = [...new Set(views.map((row) => row.event_id))];
  const referees = new Map<string, RefereeAssignmentRow[]>();
  for (const eventId of eventIds) {
    referees.set(eventId, await fetchRefereeAssignmentIndex(db, eventId));
  }
  return {
    bouts,
    rulesets,
    referees,
    tournaments: await rowsById(
      db,
      byId('tournaments', 'id, weapon, name, scoring_config_json'),
      views.map((row) => row.tournament_id),
    ),
    // Only a bracket bout needs its phase: the size turns a round number into
    // R16 / QF / SF / F, and the double-elimination split names the finals.
    phases: await rowsById(
      db,
      byId('phases', 'id, config_json'),
      views.map((row) => (row.bracket_round !== null ? row.phase_id : null)),
    ),
    pools: await rowsById(
      db,
      byId('pools', 'id, sort_order'),
      views.map((row) => row.pool_id),
    ),
    events: await rowsById(db, byId('events', 'id, timezone, status'), eventIds),
    lices: await rowsById(
      db,
      byId('lices', 'id, name'),
      [...bouts.values()].map((bout) => bout['lice_id'] as string | null),
    ),
  };
}

const PHASE_TYPES = ['pool', 'single_elim', 'double_elim', 'swiss'] as const;

function bestOfFor(row: ViewRow, matchFormat: ReturnType<typeof normalizeMatchFormatConfig>) {
  const phaseType = PHASE_TYPES.find((type) => type === row.phase_type);
  return getEffectiveBestOf(
    {
      id: row.match_id,
      redRegistrationId: '',
      blueRegistrationId: '',
      rulesetCode: 'TF_v1',
      rulesetVersion: '1.0.0',
      status: 'running',
      phaseType,
      matchNumberLabel: row.match_number_label,
    } satisfies RulesetMatch,
    matchFormat,
  );
}

/** The round code and the round's own token, from the same inputs, so they cannot disagree. */
function roundOf(row: ViewRow, context: SummaryContext, weapon: string | null) {
  const cfg = row.phase_id
    ? (context.phases.get(row.phase_id)?.['config_json'] as Row | null | undefined)
    : undefined;
  const size = cfg?.['bracketSize'] ?? cfg?.['mainBracketSize'];
  const bracketSize = typeof size === 'number' ? size : null;
  // Only the split: `bracketCodeConfig` also answers a size, and it does not
  // read `mainBracketSize`.
  const { wbRounds, lbRounds } = bracketCodeConfig(cfg);
  const sortOrder = row.pool_id ? context.pools.get(row.pool_id)?.['sort_order'] : undefined;
  const roundCode = buildRoundCode({
    weapon,
    poolNumber: typeof sortOrder === 'number' ? sortOrder + 1 : null,
    bracketRound: row.bracket_round,
    swissRound: row.swiss_round,
    bracketSize,
    wbRounds,
    lbRounds,
    matchNumberLabel: row.match_number_label,
    roundNumber: null,
  });
  const roundToken =
    row.swiss_round !== null && row.swiss_round !== undefined
      ? `S${row.swiss_round}`
      : bracketToken({ bracketRound: row.bracket_round, bracketSize, wbRounds, lbRounds });
  return { roundCode, roundToken };
}

function summaryOf(row: ViewRow, context: SummaryContext) {
  const tournament = context.tournaments.get(row.tournament_id);
  const weapon = (tournament?.['weapon'] as string | null | undefined) ?? null;
  const bout = context.bouts.get(row.match_id);
  const event = context.events.get(row.event_id);
  // The format the bout is fought under: its copy's, not its Tournament's of now (ruling E: the
  // public bout page shows the bout's copy).
  const matchFormat = boutMatchFormat(row.match_id, bout, context.rulesets.get(row.match_id));
  const liceId = (bout?.['lice_id'] as string | null | undefined) ?? null;
  // A public field, joined into a sentence by the public match page: names
  // only, each once, whatever the number of roles a person holds.
  const referees = refereeNamesOnly(
    resolveMatchReferees(context.referees.get(row.event_id) ?? [], {
      matchId: row.match_id,
      poolId: row.pool_id,
      liceId,
    }),
  );
  return {
    matchLabel: row.match_number_label ?? '',
    ...roundOf(row, context, weapon),
    status: row.status,
    poolName: row.pool_name ?? '',
    tournamentName: (tournament?.['name'] as string | null | undefined) ?? '',
    liceName: (liceId ? (context.lices.get(liceId)?.['name'] as string | null) : null) ?? '',
    redName: row.red_name ?? '',
    redClub: row.red_club ?? null,
    blueName: row.blue_name ?? '',
    blueClub: row.blue_club ?? null,
    // The venue's wall clock, for the public match view's times.
    eventTimezone: (event?.['timezone'] as string | null | undefined) ?? 'Europe/Paris',
    // The Event's results are frozen: the pad's protest button goes off (the server refuses too).
    eventOver: isOver(event?.['status']),
    referees,
    weapon: weapon ?? '',
    // For the pad opened straight on a bout: which scoring config to read, and
    // the phase-specific behaviour.
    tournamentId: row.tournament_id,
    phaseType: row.phase_type ?? null,
    // What a page needs to draw a score: the cap, the direction, the doubles
    // limit; and the organiser's side colours.
    matchFormat,
    scoringConfig: tournament?.['scoring_config_json'] ?? null,
    // The rounds. bestOf is 1 for a Tournament with no format, so the
    // scoreboard hides the round counter by default.
    bestOf: matchFormat ? bestOfFor(row, matchFormat) : 1,
    ...roundStateOf(bout),
  };
}

/**
 * A bout's match format, from its copy of its rules, or null when it does not read. Every write
 * checks it, so only a hand edit or a schema change gets here; one such Tournament threw out of
 * the whole list (a piste's bouts, the referee assignments, the match lists). Its bouts now say
 * "no format", and the log names the bout. A bout with no copy (a fault: every bout holds one)
 * says the same, logged; one deleted since the list was read too, not logged (an ordinary race,
 * the piste read polls). The public bout page and the TV draw the default for none.
 *
 * With its `ruleset`, it is the format the bout is scored with (`scoredMatchFormat`): a ruleset
 * with no venues or no doubles ceiling (Points cap) shows points and no ceiling, as it scores.
 * Without (its ruleset was not read, `shownRulesetOf` logs why), it is the copy as stored.
 */
export function boutMatchFormat(
  matchId: string,
  bout: Row | undefined,
  ruleset: Ruleset | undefined,
): ReturnType<typeof normalizeMatchFormatConfig> | null {
  if (!bout) return null; // deleted since the list was read: the list drops it next read
  const copy = asRow(bout['match_rules']);
  if (!copy) {
    logger.error(`Bout ${matchId} holds no copy of its rules`);
    return null;
  }
  try {
    const config = asRow(copy['ruleset_config']);
    if (ruleset) return scoredMatchFormat(config, ruleset);
    return normalizeMatchFormatConfig(config?.['matchFormat'] ?? {});
  } catch (err) {
    logger.error(`Bout ${matchId} has a match format that does not read`, err);
    return null;
  }
}

/**
 * The ruleset a bout's copy names, so its format is shown as it is scored. None, and a warning,
 * for a copy that names none or a ruleset that does not resolve or is not read: the format is
 * then shown as stored, which a bout on a ruleset that strips nothing shows the same.
 */
export async function shownRulesetOf(
  matchId: string,
  bout: Row,
  rulesets: RulesetResolver,
): Promise<Ruleset | undefined> {
  try {
    const { code, version } = boutEngineOf(bout);
    const ruleset = await rulesets.resolve(code, version);
    if (ruleset) return ruleset;
    logger.warn(`Bout ${matchId}: ${code}@${version} does not resolve`);
  } catch (err) {
    logger.warn(`Bout ${matchId}: its ruleset was not read: ${String(err)}`);
  }
  return undefined;
}

/** Where the bout stands in its rounds, from its own row. */
function roundStateOf(bout: Row | undefined) {
  return {
    currentRound: (bout?.['current_round'] as number | null | undefined) ?? 1,
    redRoundWins: (bout?.['red_round_wins'] as number | null | undefined) ?? 0,
    blueRoundWins: (bout?.['blue_round_wins'] as number | null | undefined) ?? 0,
    roundsJson: Array.isArray(bout?.['rounds_json']) ? (bout?.['rounds_json'] as unknown[]) : null,
    awaitingRoundAdvance: (bout?.['awaiting_round_advance'] as boolean | null | undefined) ?? false,
  };
}

/**
 * The summary of each bout of `matchIds` that the view holds, by bout id. A bout
 * the view does not hold has no entry: the caller says what that means.
 *
 * `rulesets` gives each bout its format as it is scored (`boutMatchFormat`). Null for a caller
 * that reads no format (a bout's name), or one wired without a resolver: the format is then the
 * copy as stored.
 */
export async function matchSummaries(
  db: SupabaseClient,
  matchIds: string[],
  rulesets: RulesetResolver | null,
): Promise<Map<string, MatchSummary>> {
  const views = [
    ...(
      await rowsById(
        db,
        {
          table: 'vw_tournament_query_matches',
          select: VIEW_SELECT,
          column: 'match_id',
          key: 'match_id',
        },
        matchIds,
      )
    ).values(),
  ] as unknown as ViewRow[];
  const context = await contextOf(db, views, rulesets);
  return new Map(views.map((row) => [row.match_id, summaryOf(row, context)]));
}
