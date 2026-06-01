import type { ColorToken } from '../../utils/color-token';

/**
 * Shared bracket types used by MatchCard, BracketConnectors, MedalPodium,
 * and the top-level BracketView.
 */

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
  /** Self-ref label, e.g. 'WBR1P0', 'LBR2P1', 'GF', 'BRONZE'. */
  section?: string;
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
