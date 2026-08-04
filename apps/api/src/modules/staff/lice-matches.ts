/**
 * Everything on one lice, for the piste operator's screen.
 *
 * Pure + DI-free so `staff.service.ts` can spend the same select string, the
 * same round-code derivation and the same ordering on every path that reads a
 * lice's matches. Before this, three methods each carried their own verbatim
 * copy of the eight-field round-code block; that is how two surfaces end up
 * calling the same bout by two different names.
 */

import type { TournamentScoringConfig } from '@myclash/types';
import { buildRoundCode, bracketCodeConfig } from '../matches/round-code.helper';
import type { ResolvedReferee } from '../matches/resolve-match-referees';
import { poolMatchSortKey } from '../phases/pool-match-sort';

/**
 * The ONE select for "matches on a lice".
 *
 * `pool_id` is here for referee scope precedence (match → pool → lice); the
 * older mappers ignore it, harmlessly. Every consumer reads a subset, so
 * widening this is safe and narrowing it is not.
 */
export const LICE_MATCH_SELECT =
  'id,status,scheduled_at,match_number_label,pool_id,red_score,blue_score,' +
  'ruleset_code,ruleset_version,red_registration_id,blue_registration_id,side_order,locked_at,' +
  'phases(type,config_json,tournaments(id,name,weapon,scoring_config_json,ruleset_config)),' +
  'pools(sort_order),bracket_slots(round),swiss_rounds(round_number),' +
  'red:registrations!matches_red_registration_id_fkey(id,persons(given_name,family_name)),' +
  'blue:registrations!matches_blue_registration_id_fkey(id,persons(given_name,family_name))';

/**
 * Everything a piste operator can act on or review. `voided` is excluded — it
 * is a deleted bout — which also keeps this list walking the same set as the
 * pad's prev/next arrows (`getMatchNeighbors`).
 */
export const LICE_MATCH_STATUSES = ['scheduled', 'running', 'paused', 'completed'] as const;

/** One row of the piste's day. */
export interface LiceMatchRow {
  id: string;
  /** `scheduled` | `running` | `paused` | `completed` — never `voided`. */
  status: string;
  /** Carried for referee scope precedence; the UI may later group by pool. */
  poolId: string | null;
  scheduledAt: string | null;
  matchNumberLabel: string | null;
  /** Server-derived, e.g. `SDW-B-SF-M2`. */
  roundCode: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  tournamentId: string | null;
  tournamentName: string | null;
  /** `pool` | `single_elim` | `double_elim` | `swiss` — which views to offer. */
  phaseType: string | null;
  /** Drives `sideStyle()` for the corner dots. Never hardcode a side colour. */
  scoringConfig: TournamentScoringConfig | null;
  /** Resolved by scope precedence. Empty means "show no referee line". */
  referees: ResolvedReferee[];
}

export interface LiceMatchesPayload {
  liceId: string;
  /**
   * RAW, e.g. `Lice 4`. Callers prefix NOTHING — the organizer's own default
   * naming already produces "Lice N", so a "Lice {name}" template renders
   * "Lice Lice 4".
   */
  liceName: string;
  event: { id: string; slug: string; name: string; status: string } | null;
  /** Full schedule order, unlimited, completed bouts included. */
  matches: LiceMatchRow[];
}

interface PersonEmbed {
  given_name?: string | null;
  family_name?: string | null;
}

/** `"Given Family"`, or null when neither half is present. */
export function formatPersonName(person: PersonEmbed | null | undefined): string | null {
  if (!person) return null;
  const composed = `${person.given_name ?? ''} ${person.family_name ?? ''}`.trim();
  return composed || null;
}

/**
 * Round code from a raw `matches` row.
 *
 * Was copy-pasted verbatim into `mapCurrentMatch`, `mapNeighborRow` and
 * `resolveNextMatchOnLice`. One reader means the three can no longer drift
 * apart on bracket or Swiss labels.
 */
export function roundCodeFromMatchRow(row: Record<string, unknown>): string {
  const phase = row['phases'] as {
    config_json?: Record<string, unknown> | null;
    tournaments?: { weapon?: string };
  } | null;
  const pool = row['pools'] as { sort_order?: number } | null;
  const bracketSlot = row['bracket_slots'] as { round?: number } | null;
  const swissRoundEmbed = row['swiss_rounds'] as { round_number?: number } | null;
  const phaseCfg = phase?.config_json ?? null;
  const sizeRaw = (phaseCfg?.['bracketSize'] ?? phaseCfg?.['mainBracketSize']) as
    | number
    | undefined;
  const { wbRounds, lbRounds } = bracketCodeConfig(phaseCfg);
  return buildRoundCode({
    weapon: phase?.tournaments?.weapon ?? null,
    poolNumber: typeof pool?.sort_order === 'number' ? pool.sort_order + 1 : null,
    bracketRound: typeof bracketSlot?.round === 'number' ? bracketSlot.round : null,
    swissRound:
      typeof swissRoundEmbed?.round_number === 'number' ? swissRoundEmbed.round_number : null,
    bracketSize: typeof sizeRaw === 'number' ? sizeRaw : null,
    wbRounds,
    lbRounds,
    matchNumberLabel: (row['match_number_label'] as string | null) ?? null,
    roundNumber: null,
  });
}

/**
 * Schedule order: `scheduled_at` ascending with unscheduled bouts last, then
 * the match number.
 *
 * The tie-break is done here rather than in PostgREST because PostgREST sorts
 * `match_number_label` as a string, which puts M10 ahead of M2 as soon as a
 * pool reaches double digits — the same trap `poolMatchSortKey` already
 * covers on the admin Matches tab.
 */
export function compareLiceMatchOrder(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const at = (a['scheduled_at'] as string | null) ?? null;
  const bt = (b['scheduled_at'] as string | null) ?? null;
  if (at !== bt) {
    if (at === null) return 1;
    if (bt === null) return -1;
    return at < bt ? -1 : 1;
  }
  return (
    poolMatchSortKey((a['match_number_label'] as string | null) ?? null) -
    poolMatchSortKey((b['match_number_label'] as string | null) ?? null)
  );
}

export function mapLiceMatchRow(
  row: Record<string, unknown>,
  referees: ResolvedReferee[],
): LiceMatchRow {
  const phase = row['phases'] as {
    type?: string;
    tournaments?: { id?: string; name?: string; scoring_config_json?: unknown };
  } | null;
  const red = row['red'] as { persons?: PersonEmbed } | null;
  const blue = row['blue'] as { persons?: PersonEmbed } | null;
  return {
    id: row['id'] as string,
    status: row['status'] as string,
    poolId: (row['pool_id'] as string | null) ?? null,
    scheduledAt: (row['scheduled_at'] as string | null) ?? null,
    matchNumberLabel: (row['match_number_label'] as string | null) ?? null,
    roundCode: roundCodeFromMatchRow(row),
    redFighterName: formatPersonName(red?.persons),
    blueFighterName: formatPersonName(blue?.persons),
    redScore: (row['red_score'] as number | null) ?? 0,
    blueScore: (row['blue_score'] as number | null) ?? 0,
    // Already joined by LICE_MATCH_SELECT — the screen needs the id to reach
    // the tournament's pools and bracket, and the phase type to know which of
    // those two even exist.
    tournamentId: phase?.tournaments?.id ?? null,
    tournamentName: phase?.tournaments?.name ?? null,
    phaseType: phase?.type ?? null,
    scoringConfig: (phase?.tournaments?.scoring_config_json as TournamentScoringConfig) ?? null,
    referees,
  };
}
