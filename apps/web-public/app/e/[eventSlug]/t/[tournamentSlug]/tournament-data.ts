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
  status: string;
  matchId: string | null;
  redRegistrationId?: string | null;
  blueRegistrationId?: string | null;
}

export interface Tournament {
  id: string;
  name: string;
  weapon: string | null;
  rulesetCode: string;
  status: string;
  color?: string | null;
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
}

/** Gold/silver/bronze/4th from bracketSlots — position 1 at maxRound is the
 *  final, position 2 (when present) the bronze match. Undefined when no data. */
export function derivePodium(bracketSlots: BracketSlot[]): PodiumData | undefined {
  if (bracketSlots.length === 0) return undefined;
  const maxRound = bracketSlots.reduce((m, s) => Math.max(m, s.round), 0);
  const final = bracketSlots.find((s) => s.round === maxRound && s.position === 1) ?? null;
  const bronze = bracketSlots.find((s) => s.round === maxRound && s.position === 2) ?? null;
  if (!final && !bronze) return undefined;
  const winnerName = (s: BracketSlot | null) => {
    if (!s || s.status !== 'completed') return null;
    const rs = s.redScore ?? 0;
    const bs = s.blueScore ?? 0;
    if (rs === bs) return null;
    const name = rs > bs ? s.redFighterName : s.blueFighterName;
    return name ? { fighterName: name } : null;
  };
  const loserName = (s: BracketSlot | null) => {
    if (!s || s.status !== 'completed') return null;
    const rs = s.redScore ?? 0;
    const bs = s.blueScore ?? 0;
    if (rs === bs) return null;
    const name = rs > bs ? s.blueFighterName : s.redFighterName;
    return name ? { fighterName: name } : null;
  };
  return {
    gold: winnerName(final),
    silver: loserName(final),
    bronze: winnerName(bronze),
    fourth: loserName(bronze),
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
