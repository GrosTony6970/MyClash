import type { ColorToken } from '../../utils/color-token';

/**
 * Shared bracket types used by MatchCard, BracketConnectors, MedalPodium,
 * and the top-level BracketView.
 */

/** A referee assigned to a bracket match (scope_type='match'). Mirrors the
 *  public pool-footer shape so both surfaces render referees identically. */
export interface BracketReferee {
  role: string | null;
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
  /** Registration ids for the two sides. Required by the inline WO
   *  (forfeit) flow so the bracket page can post the right
   *  `forfeitingRegistrationId` without an extra fetch. Optional so
   *  legacy bracket fetches that didn't project them still type-check. */
  redRegistrationId?: string | null;
  blueRegistrationId?: string | null;
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
