// apps/api/src/modules/staff/live-board.ts

import { boutSideLabels, sideNamesAndColours } from '../matches/bout-side-labels';
import { roundCodeFromMatchRow } from '../matches/round-code.helper';
import { resolveMatchReferees } from '../matches/resolve-match-referees';
import type { RegistrationEmbed, TeamEmbed } from '../matches/side-label';
import type { RefereeAssignmentRow, ResolvedReferee } from '../matches/resolve-match-referees';
import type { MatchLengthInput } from '../schedule/match-lengths';
import { plannedLengthOf } from '../schedule/planned-length';
import type {
  BoardHealth,
  BoardAttention,
  BoardMatch,
  BoardQueueEntry,
  BoardRow,
  BoardScorer,
  LiveBoardAccount,
} from './live-board-payload';

/**
 * The statuses that occupy a piste. Named because `assembleBoardRows` relies on
 * exact equality to keep completed bouts out of `currentMatch` and `queue` —
 * the completed tail is fed in separately (see `recentCompleted`), and a
 * `!== 'completed'` style filter would silently promote a finished bout the
 * moment another status joined the enum.
 */
const LIVE_STATUSES = ['running', 'paused'] as const;

/** The bout's code (`LSW-P4-M01`): every bout name the board sends, never the stored label. */
function codeOf(row: RawBoardMatch | RawCompletedMatch): string {
  return roundCodeFromMatchRow(row as unknown as Record<string, unknown>);
}

export interface RawBoardMatch {
  id: string;
  lice_id: string;
  status: string;
  red_score: number;
  blue_score: number;
  match_number_label: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  pool_id: string | null;
  phase_id: string;
  planned_duration_override_minutes: number | null;
  bracket_slots: { round?: number } | null;
  /**
   * The Swiss round, when this is a Swiss bout. `staff.service.ts` has been
   * selecting `swiss_rounds(round_number)` since the Swiss schema landed, but
   * nothing read it — so every Swiss row on the live board showed no round.
   */
  swiss_rounds?: { round_number?: number } | null;
  pools?: { name?: string; sort_order?: number } | null;
  phases?: {
    type?: string;
    config_json?: Record<string, unknown> | null;
    tournaments?: { name?: string; weapon?: string } | null;
  } | null;
  red: RegistrationEmbed<never> | null;
  blue: RegistrationEmbed<never> | null;
  /** A team side (`TEAM_SIDE_EMBEDS`); a side is a Registration or a team, never both. */
  red_team?: TeamEmbed | null;
  blue_team?: TeamEmbed | null;
}

/**
 * The finished-bout tail. Narrower than RawBoardMatch on purpose: only
 * `pickLastCompleted` reads it, so the query need not drag fighter embeds and
 * round joins across the wire for bouts nobody is watching.
 */
export interface RawCompletedMatch {
  id: string;
  lice_id: string;
  match_number_label: string | null;
  scheduled_at: string | null;
  ended_at: string | null;
  /** The bout code's inputs (`roundCodeFromMatchRow`). */
  phases?: {
    config_json?: Record<string, unknown> | null;
    tournaments?: { weapon?: string } | null;
  } | null;
  pools?: { sort_order?: number } | null;
  bracket_slots?: { round?: number } | null;
  swiss_rounds?: { round_number?: number } | null;
}

export interface RawBoardLice {
  id: string;
  name: string;
  sort_order: number;
  location_label: string | null;
  /** `lices.color_hex`. There is no `lices.color` column — do not select one. */
  color_hex: string | null;
  venues: { id: string; name: string } | null;
  venue_areas: { id: string; name: string } | null;
}

export interface BoardAccountInput {
  id: string;
  display_name: string;
  username: string | null;
  status: string | null;
  last_seen_at: string | null;
  outbox_depth: number | null;
  oldest_pending_age_seconds: number | null;
  rejected_count: number | null;
  clock_skew_ms: number | null;
  needs_attention: boolean;
  needs_attention_reason: 'medic' | 'head_ref' | 'dispute' | null;
}

/**
 * A device is ON a piste while it checks in from it: three missed 20-second
 * check-ins and it no longer counts (ruling 953). Measured on the server's real
 * clock, the one that stamps each report.
 */
export const TABLET_PRESENCE_MS = 60_000;

export interface AssembleInput {
  lices: RawBoardLice[];
  matches: RawBoardMatch[];
  /** Recently finished bouts, newest first, for `lastCompleted`. */
  recentCompleted: RawCompletedMatch[];
  accounts: BoardAccountInput[];
  assignments: Array<{ staff_account_id: string; lice_id: string }>;
  /** Officiating referees for the current bout, keyed by match id. */
  refereesByMatchId: Map<string, ResolvedReferee[]>;
  /** Every bout's planned length, as `resolveMatchLengths` returns it for `matches`. */
  plannedMinutesByMatchId: ReadonlyMap<string, number>;
  /** Tablets heard from lately, by piste (`countTabletsByLice`). */
  tabletsByLiceId: ReadonlyMap<string, number>;
}

/** The devices of recent reports, counted by the piste each has open. */
export function countTabletsByLice(
  reports: ReadonlyArray<{ lice_id: string | null }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { lice_id } of reports) {
    if (lice_id) counts.set(lice_id, (counts.get(lice_id) ?? 0) + 1);
  }
  return counts;
}

/** What `resolveMatchLengths` needs of a board bout. */
export function boardLengthInput(row: RawBoardMatch): MatchLengthInput {
  return {
    id: row.id,
    phaseId: row.phase_id,
    plannedDurationOverrideMinutes: row.planned_duration_override_minutes,
  };
}

export function mapBoardMatch(
  row: RawBoardMatch,
  plannedDurationMinutes: number,
  referees: ResolvedReferee[] = [],
): BoardMatch {
  return {
    id: row.id,
    ...sideNamesAndColours(boutSideLabels(row)),
    redScore: row.red_score,
    blueScore: row.blue_score,
    status: row.status,
    // Bracket first, then Swiss: the two sources are mutually exclusive on a
    // real match row (a match belongs to one phase), so the order is only for
    // readability.
    round:
      typeof row.bracket_slots?.round === 'number'
        ? row.bracket_slots.round
        : typeof row.swiss_rounds?.round_number === 'number'
          ? row.swiss_rounds.round_number
          : null,
    roundCode: codeOf(row),
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    poolName: row.pools?.name ?? null,
    tournamentName: row.phases?.tournaments?.name ?? null,
    phaseType: row.phases?.type ?? null,
    plannedDurationMinutes,
    referees: referees.map((r) => ({
      name: r.name,
      roleLabel: r.roleLabel,
      roleColor: r.roleColor,
      status: r.status,
    })),
  };
}

/** The bout occupying this piste: running/paused first, else the next scheduled. */
function pickCurrent(liceMatches: RawBoardMatch[]): RawBoardMatch | null {
  return (
    liceMatches.find((m) => (LIVE_STATUSES as readonly string[]).includes(m.status)) ??
    liceMatches.find((m) => m.status === 'scheduled') ??
    null
  );
}

/**
 * Which bout a given piste is showing, from the whole event's match list.
 *
 * Exported so the referee resolver and `assembleBoardRows` agree by
 * construction: resolving referees for one bout and rendering another is the
 * kind of mismatch that reads as a correct screen.
 */
export function pickCurrentForLice(matches: RawBoardMatch[], liceId: string): RawBoardMatch | null {
  return pickCurrent(matches.filter((m) => m.lice_id === liceId));
}

/**
 * The next bouts due on this piste, soonest first, excluding whatever is
 * already showing as current.
 *
 * Sorted here rather than relying on the query's ORDER BY: the board's own
 * status precedence means "current" is not always the first row, and a queue
 * whose order depends on how PostgREST grouped statuses is a defect waiting
 * for the day someone adds a status.
 */
function buildQueue(
  liceMatches: RawBoardMatch[],
  currentId: string | undefined,
): BoardQueueEntry[] {
  return liceMatches
    .filter((m) => m.status === 'scheduled' && m.id !== currentId)
    .slice()
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
    .slice(0, 3)
    .map((m) => ({
      matchId: m.id,
      label: codeOf(m),
      scheduledAt: m.scheduled_at,
    }));
}

/**
 * The most recently finished bout on this piste.
 *
 * Falls back to `scheduled_at` when `ended_at` is null: bouts completed before
 * the clock columns landed carry no end time, and ordering them last would
 * make an old event's board claim its first bout was its most recent.
 */
function pickLastCompleted(completed: RawCompletedMatch[]): BoardRow['lastCompleted'] {
  let best: RawCompletedMatch | null = null;
  for (const m of completed) {
    const key = m.ended_at ?? m.scheduled_at ?? '';
    const bestKey = best ? (best.ended_at ?? best.scheduled_at ?? '') : '';
    if (!best || key > bestKey) best = m;
  }
  return best ? { matchId: best.id, label: codeOf(best), endedAt: best.ended_at } : null;
}

/** The account driving this piste, plus everyone else assigned to it. */
function buildScorer(assigned: BoardAccountInput[]): BoardScorer | null {
  const primary = assigned[0];
  if (!primary) return null;
  const others = assigned.slice(1).map((a) => ({
    accountId: a.id,
    name: a.display_name,
    lastSeenAt: a.last_seen_at,
  }));
  return {
    accountId: primary.id,
    name: primary.display_name,
    username: primary.username,
    status: primary.status,
    lastSeenAt: primary.last_seen_at,
    otherCount: others.length,
    others,
  };
}

/** Health is UNKNOWN unless the tablet has reported at least one metric. */
function buildHealth(primary: BoardAccountInput | null): BoardHealth | null {
  if (!primary || primary.outbox_depth === null) return null;
  return {
    outboxDepth: primary.outbox_depth ?? 0,
    oldestPendingAgeSec: primary.oldest_pending_age_seconds ?? 0,
    rejectedCount: primary.rejected_count ?? 0,
    // `?? null`, deliberately NOT `?? 0`: a tablet that has never reported its
    // clock has an unknown skew, and a rendered 0 would read as "verified fine".
    clockSkewMs: primary.clock_skew_ms ?? null,
  };
}

function buildAttention(primary: BoardAccountInput | null): BoardAttention | null {
  return primary && primary.needs_attention && primary.needs_attention_reason
    ? { reason: primary.needs_attention_reason }
    : null;
}

/** The accounts covering one piste, most-recently-seen first. */
function assignedTo(
  lice: RawBoardLice,
  input: AssembleInput,
  accountById: Map<string, BoardAccountInput>,
): BoardAccountInput[] {
  return input.assignments
    .filter((a) => a.lice_id === lice.id)
    .map((a) => accountById.get(a.staff_account_id))
    .filter((a): a is BoardAccountInput => Boolean(a))
    .sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''));
}

function assembleRow(
  lice: RawBoardLice,
  input: AssembleInput,
  accountById: Map<string, BoardAccountInput>,
): BoardRow {
  const liceMatches = input.matches.filter((m) => m.lice_id === lice.id);
  const currentRaw = pickCurrent(liceMatches);
  const queue = buildQueue(liceMatches, currentRaw?.id);
  const assigned = assignedTo(lice, input, accountById);
  const primary = assigned[0] ?? null;

  return {
    lice: {
      id: lice.id,
      name: lice.name,
      sortOrder: lice.sort_order,
      locationLabel: lice.location_label,
      colorHex: lice.color_hex,
      venue: lice.venues ? { id: lice.venues.id, name: lice.venues.name } : null,
      area: lice.venue_areas ? { id: lice.venue_areas.id, name: lice.venue_areas.name } : null,
    },
    currentMatch: currentRaw
      ? mapBoardMatch(
          currentRaw,
          plannedLengthOf(input.plannedMinutesByMatchId, currentRaw.id),
          input.refereesByMatchId.get(currentRaw.id) ?? [],
        )
      : null,
    scorer: buildScorer(assigned),
    health: buildHealth(primary),
    attention: buildAttention(primary),
    nextUp: queue[0] ? { matchId: queue[0].matchId, label: queue[0].label } : null,
    queue,
    lastCompleted: pickLastCompleted(input.recentCompleted.filter((m) => m.lice_id === lice.id)),
    tablets: input.tabletsByLiceId.get(lice.id) ?? 0,
  };
}

export function assembleBoardRows(input: AssembleInput): BoardRow[] {
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  return input.lices
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((lice) => assembleRow(lice, input, accountById));
}

/**
 * Officiating referees for the bout each piste is currently showing.
 *
 * Resolved for the CURRENT bout only: doing it for every queued bout multiplies
 * the scan for information a collapsed row never shows. Keyed by match id so
 * `assembleBoardRows` cannot pair a bout with another bout's referees.
 */
export function resolveBoardReferees(
  matches: RawBoardMatch[],
  liceIds: readonly string[],
  refereeRows: RefereeAssignmentRow[],
): Map<string, ResolvedReferee[]> {
  const byMatchId = new Map<string, ResolvedReferee[]>();
  for (const liceId of liceIds) {
    const current = pickCurrentForLice(matches, liceId);
    if (!current) continue;
    byMatchId.set(
      current.id,
      resolveMatchReferees(refereeRows, {
        matchId: current.id,
        poolId: current.pool_id,
        liceId,
      }),
    );
  }
  return byMatchId;
}

/** Flatten accounts + assignments into the reassign picker's option list. */
export function buildBoardAccounts(
  accounts: BoardAccountInput[],
  assignments: Array<{ staff_account_id: string; lice_id: string }>,
): LiveBoardAccount[] {
  return accounts.map((a) => ({
    accountId: a.id,
    name: a.display_name,
    username: a.username,
    status: a.status,
    lastSeenAt: a.last_seen_at,
    liceIds: assignments.filter((x) => x.staff_account_id === a.id).map((x) => x.lice_id),
  }));
}
