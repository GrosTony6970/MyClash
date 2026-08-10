/**
 * Shared tournament-data contract + pure helpers for the tournament view.
 *
 * Lifted out of the public `page.tsx` (an async server component) so the
 * personal-space in-app tournament page — a client component — can reuse the
 * exact same `TournamentData` shape, `derivePodium`, and `colorTokenToHex`
 * without importing the server page. The public page imports from here too, so
 * the two surfaces never drift. No `'use client'`, no async, no server-only
 * APIs — safe in both contexts.
 */

import type { PodiumData } from '@myclash/ui';
import { resolveMatchWinner } from '@myclash/types';
import type { PoolMember, PoolReferee } from './PoolsCompositionView';

export interface StandingRow {
  registrationId: string;
  fighterName: string;
  clubName: string | null;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  doubles: number;
  score: number;
  seed: number;
}

export interface Pool {
  id: string;
  name: string;
  members: PoolMember[];
  referees: PoolReferee[];
  standings: StandingRow[];
  liceName?: string | null;
  liceColorHex?: string | null;
  startAt?: string | null;
}

export interface BracketSlot {
  id: string;
  round: number;
  position: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  redClubAbbrev?: string | null;
  blueClubAbbrev?: string | null;
  redScore: number | null;
  blueScore: number | null;
  /** Recorded match winner — authoritative over score comparison (a forfeit
   *  can complete a match with the lower-scored fighter winning). */
  winnerRegistrationId?: string | null;
  status: string;
  matchId: string | null;
  redRegistrationId?: string | null;
  blueRegistrationId?: string | null;
  /** Assigned piste ("lice") name — rendered as a pill beside the match code,
   *  mirroring the admin bracket. Null when no piste is assigned. */
  liceName?: string | null;
  /** Referees assigned to this bracket match (scope_type='match'). Rendered on
   *  the card when the bracket's fold/unfold toggle is on. */
  referees?: PoolReferee[];
}

/** Per-bucket lineage diff, materialised at re-pin time. Mirrors @myclash/rulesets'
 *  BucketDiff (kept local — web-public doesn't depend on the rulesets package). */
export interface RulesetRepinBucketDiff {
  grammar: 'unchanged' | 'changed';
  endConditions: 'unchanged' | 'changed';
  ranking: 'unchanged' | 'changed';
  rankingCompatible: boolean;
}

/** Public disclosure of an audited mid-event ruleset re-pin (the reason is
 *  shown publicly by design — a re-pin is never silent). */
export interface RulesetRepinDisclosure {
  changedAt: string;
  fromLabel: string;
  toLabel: string;
  justification: string;
  rankingCompatible: boolean;
  /** Materialised per-bucket breakdown (grammar/end-conditions/ranking); absent
   *  on audit rows written before the diff was disclosed. */
  bucketDiff?: RulesetRepinBucketDiff | null;
}

export interface Tournament {
  id: string;
  name: string;
  weapon: string | null;
  rulesetCode: string;
  /** Human ruleset name (e.g. "TF_v1"); falls back to the raw code. */
  rulesetLabel?: string;
  status: string;
  color?: string | null;
  /** The organiser's configured fighter-side colour tokens. Distinct from
   *  `color` above, which is the tournament's own identity colour. */
  sideColors?: { red: string; blue: string } | null;
  /** Present when the tournament's ruleset was re-pinned mid-event. */
  rulesetRepin?: RulesetRepinDisclosure | null;
}

export interface TournamentData {
  tournament: Tournament;
  pools: Pool[];
  bracketSlots: BracketSlot[];
  bracketSize: number;
  mainBracketSize?: number;
  byeCount?: number;
  byeSeedCount?: number;
  playInMatchCount?: number;
  hasPlayInRound?: boolean;
  bracketRounds: number;
  /**
   * The phase that decides this tournament. Absent on legacy payloads →
   * single-elim.
   *
   * `'swiss'` is not a bracket shape — it is the absence of one, and it appears
   * here only when the tournament has a Swiss phase and NO elimination phase.
   * It must reach `computeFinalRanking`, which takes a third branch for it;
   * letting it fall through to the single-elim default would rank a Swiss field
   * off an empty slot tree and produce nothing.
   */
  phaseType?: TournamentPhaseType;
  wbRounds?: number | null;
  lbRounds?: number | null;
  secondChanceTarget?: 'gold' | 'bronze' | null;
  bronzeMatch?: boolean | null;
  repechageEntryRound?: number | null;
  /** Present when the tournament has a Swiss phase. Drives the Swiss tab. */
  swissPhaseId?: string | null;
  swissRoundCount?: number;
  swissRoundsCompleted?: number;
  /** The organiser froze the standings, so the podium is decided. */
  swissFinalized?: boolean;
}

export type TournamentPhaseType = 'single_elim' | 'double_elim' | 'swiss';

/**
 * The bracket-shaped subset of `phaseType`, for components that draw a bracket.
 *
 * `BracketLive` feeds `BracketView.bracketConfig` in @myclash/ui, and a Swiss
 * tournament has no slots for it to draw — so it is narrowed HERE, once, rather
 * than widening a UI-package type for a value that can never reach it.
 */
export function bracketPhaseType(
  phaseType?: TournamentPhaseType,
): 'single_elim' | 'double_elim' | undefined {
  return phaseType === 'swiss' ? undefined : phaseType;
}

/** The bracket shape needed to read a double-elim podium. */
export interface PodiumShape {
  // Widened with the payload: harmless here, since this only ever tests for
  // double-elim and returns undefined for an empty slot list anyway.
  phaseType?: TournamentPhaseType;
  wbRounds?: number | null;
  lbRounds?: number | null;
  /** Bronze mode has no grand final — the winners-bracket final takes the title. */
  secondChanceTarget?: 'gold' | 'bronze' | null;
  bronzeMatch?: boolean | null;
}

// This was the correct implementation while three other copies drifted; it is
// now the shared one in @myclash/types, which says the same thing.
function winnerSide(s: BracketSlot | null): 'red' | 'blue' | null {
  if (!s) return null;
  return resolveMatchWinner(s);
}

function winnerName(s: BracketSlot | null) {
  const side = winnerSide(s);
  if (!side) return null;
  const name = side === 'red' ? s!.redFighterName : s!.blueFighterName;
  return name ? { fighterName: name } : null;
}

function loserName(s: BracketSlot | null) {
  const side = winnerSide(s);
  if (!side) return null;
  const name = side === 'red' ? s!.blueFighterName : s!.redFighterName;
  return name ? { fighterName: name } : null;
}

/** Which slots decide each podium place, and how to read them. */
interface PodiumSlots {
  final: BracketSlot | null;
  bronze: BracketSlot | null;
  fourthSlot: BracketSlot | null;
  /** True when 3rd/4th are the WINNER/loser of one match rather than the
   *  LOSERS of two consecutive rounds. */
  bronzeIsMatch: boolean;
}

/**
 * Locate the deciding slots for each podium model.
 *
 * Single-elim: position 1 at maxRound is the final, position 2 (when present)
 * the bronze match.
 *
 * Double-elim, GOLD: gold/silver come from the last PLAYED grand final — the
 * reset slot exists whenever the option is on but is only played when the
 * losers-bracket entrant wins, so reading maxRound blindly would show an
 * undecided podium forever. Nobody plays for bronze: 3rd is whoever lost the
 * losers-bracket final, 4th the LB semi's loser.
 *
 * Double-elim, BRONZE: there is no grand final at all. Gold/silver come from
 * the WINNERS-bracket final, and the repechage's last round IS a bronze match
 * — so it reads like single-elim's, winner 3rd and loser 4th.
 */
function podiumSlots(bracketSlots: BracketSlot[], shape?: PodiumShape): PodiumSlots {
  const at = (round: number, position = 1) =>
    bracketSlots.find((s) => s.round === round && s.position === position) ?? null;

  if (shape?.phaseType !== 'double_elim') {
    const maxRound = bracketSlots.reduce((m, s) => Math.max(m, s.round), 0);
    return {
      final: at(maxRound, 1),
      bronze: at(maxRound, 2),
      fourthSlot: null,
      bronzeIsMatch: true,
    };
  }

  const wbRounds = shape.wbRounds ?? 0;
  const lbRounds = shape.lbRounds ?? 0;

  if (shape.secondChanceTarget === 'bronze') {
    return {
      final: at(wbRounds),
      // With no bronze match the last repechage round leaves TWO survivors who
      // are separated by pool score — a tiebreak this function has no scores
      // for. The Final ranking tab is the authority there; the podium summary
      // shows gold/silver only rather than guessing.
      bronze: shape.bronzeMatch === false ? null : at(wbRounds + lbRounds),
      fourthSlot: null,
      bronzeIsMatch: true,
    };
  }

  const gfRound = wbRounds + lbRounds + 1;
  const reset = at(gfRound + 1);
  return {
    final: reset && reset.status === 'completed' ? reset : at(gfRound),
    bronze: at(gfRound - 1),
    fourthSlot: at(gfRound - 2),
    bronzeIsMatch: false,
  };
}

/** Gold/silver/bronze/4th from bracketSlots. */
export function derivePodium(
  bracketSlots: BracketSlot[],
  shape?: PodiumShape,
): PodiumData | undefined {
  if (bracketSlots.length === 0) return undefined;
  const { final, bronze, fourthSlot, bronzeIsMatch } = podiumSlots(bracketSlots, shape);
  if (!final && !bronze) return undefined;

  return {
    gold: winnerName(final),
    silver: loserName(final),
    // A bronze MATCH gives 3rd to its winner; classical double-elim instead
    // reads the LOSERS of two consecutive losers-bracket rounds.
    bronze: bronzeIsMatch ? winnerName(bronze) : loserName(bronze),
    fourth: bronzeIsMatch ? loserName(bronze) : loserName(fourthSlot),
  };
}

/** Tournament brand colour token → hex for the legacy stripe/title paint. */
export function colorTokenToHex(token: string | null | undefined): string {
  switch (token) {
    case 'red':
      return '#ef4444';
    case 'orange':
      return '#f97316';
    case 'amber':
      return '#f59e0b';
    case 'yellow':
      return '#eab308';
    case 'green':
      return '#22c55e';
    case 'teal':
      return '#14b8a6';
    case 'blue':
      return '#3b82f6';
    case 'violet':
      return '#8b5cf6';
    case 'purple':
      return '#a855f7';
    case 'pink':
      return '#ec4899';
    case 'gold':
      return '#facc15';
    case 'silver':
      return '#cbd5e1';
    case 'bronze':
      return '#d97706';
    default:
      return '#64748b';
  }
}

// ── Pool standings (live) ────────────────────────────────────────────────────

/**
 * A row as the API returns it from `tournaments/:id/pool-standings`.
 *
 * `stats` is ruleset-driven: the active ruleset decides which keys exist
 * (Generic_PointsCap declares none of the extended ones), so every read must
 * tolerate a missing key rather than assume the shape.
 */
export interface ApiStandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: 'in_progress' | 'completed';
  stats: Record<string, number | string>;
}

export interface ApiPoolStandings {
  pools?: Array<{ poolId: string; poolName: string; rows: ApiStandingsRow[] }>;
}

function statNum(stats: Record<string, number | string>, key: string): number {
  const v = stats[key];
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

/**
 * Adapt the API's ruleset-driven row to the fixed-field shape StandingsTable
 * renders. The Overall table sidesteps this by rendering `row.stats[column.key]`
 * generically; the per-pool table predates that and wants named fields.
 *
 * `seed` has no equivalent on the API row and is unused by the table — it is
 * only in the type. Kept at 0 rather than faked.
 */
export function toStandingRow(row: ApiStandingsRow): StandingRow {
  return {
    registrationId: row.registrationId,
    fighterName: row.displayName,
    clubName: row.club?.name ?? null,
    wins: statNum(row.stats, 'W'),
    losses: statNum(row.stats, 'L'),
    draws: statNum(row.stats, 'D'),
    pointsFor: statNum(row.stats, 'ptsScored'),
    pointsAgainst: statNum(row.stats, 'ptsConceded'),
    doubles: statNum(row.stats, 'doubles'),
    score: statNum(row.stats, 'score'),
    seed: 0,
  };
}
