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
