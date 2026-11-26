import type { BracketSideWire } from '@myclash/types/bracket-side';
import type { ColorToken } from '../../utils/color-token';

/**
 * Shared bracket types used by MatchCard, BracketConnectors, MedalPodium,
 * and the top-level BracketView.
 */

/** A referee assigned to a bracket match (scope_type='match'). Mirrors the
 *  public pool-footer shape so both surfaces render referees identically. */
export interface BracketReferee {
  /** A `referee_skills.id` — an opaque id, NOT a human label. */
  role: string | null;
  /**
   * `referee_skills.name` for that id. Optional so payloads that ship only the
   * raw role still type-check; when present the card prefers it, which is what
   * stops the chip printing `arbitre_declarant` at a referee.
   */
  roleLabel?: string | null;
  displayName: string;
  status: string;
  /** Colour token of the role's referee_skill (e.g. 'red', 'slate'). */
  skillColor: string;
}

export interface BracketSlotData {
  id: string;
  round: number;
  position: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  redClubAbbrev?: string | null;
  blueClubAbbrev?: string | null;
  redScore: number | null;
  blueScore: number | null;
  status: string;
  matchId: string | null;
  /** Registration ids for the two sides, null on a team side. The inline WO
   *  (forfeit) flow posts `forfeitingRegistrationId` from them without an
   *  extra fetch, and the "you" mark compares them. */
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  /** Side keys (`sideKey`) of the two sides: the Registration id or the team
   *  id, null while not known. The API builds them; no app maps them. */
  redSideId: string | null;
  blueSideId: string | null;
  /** The RECORDED winner's side key, authoritative over the two scores — a
   *  forfeit, a walkover or a `referee_decision` override can award the bout to
   *  the side behind on points. */
  winnerSideId: string | null;
  /** Each side as the API sends it: kind, name and a team's colour. */
  red: BracketSideWire | null;
  blue: BracketSideWire | null;
  /** Lice currently assigned to this slot's match. Drives the
   *  cross-app click into the scoring app's ScoringPad. Null
   *  when the operator hasn't placed the match on a lice yet —
   *  bracket page falls back to the per-match scoring URL in that case. */
  liceId?: string | null;
  /** Human name of the assigned lice (e.g. "Lice 2"), for the top-left pill on
   *  the card. Enriched by the bracket page from the event's lices list;
   *  optional so other consumers type-check without it. */
  liceName?: string | null;
  /** Self-ref label, e.g. 'WBR1P0', 'LBR2P1', 'GF', 'BRONZE'. */
  section?: string;
  /** Advancement refs from the bracket generator, e.g. 'seed 1',
   *  'winner of R0P2', 'bye'. The single-elim layout parses the
   *  `winner of RxPy` form to draw exact connectors (and align the
   *  play-in column) instead of guessing by position — which breaks
   *  the moment a round isn't a clean halving of the next. Optional
   *  so consumers that don't project them fall back gracefully. */
  source_a_ref?: string | null;
  source_b_ref?: string | null;
  /** Referees assigned to this slot's match. Rendered under the card when the
   *  bracket's `showReferees` flag is on. Optional so admin/legacy fetches that
   *  don't project them type-check and render unchanged. */
  referees?: BracketReferee[];
}

export interface BracketConfig {
  phaseType: 'single_elim' | 'double_elim';
  rounds?: number;
  wbRounds?: number;
  lbRounds?: number;
}

export interface PodiumFighter {
  fighterName: string;
  clubAbbrev?: string | null;
}

export interface PodiumData {
  gold?: PodiumFighter | null;
  silver?: PodiumFighter | null;
  bronze?: PodiumFighter | null;
  fourth?: PodiumFighter | null;
}

export type { ColorToken };
