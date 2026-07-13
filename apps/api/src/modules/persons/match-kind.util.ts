/**
 * match-kind.util.ts
 *
 * Shared helpers for turning a phase type + bracket round into a normalised
 * "match kind" token (pool / play_in / round_of / quarter_final / semi_final /
 * final / swiss) plus the fighter count for round_of. Used by both the personal
 * space cross-event aggregation (me-events.service) and the per-event
 * my-schedule payload (public-schedule.service) so the derivation stays in one
 * place.
 *
 * Pure `computeMatchKind` + a tiny `fetchBracketRounds` DB helper (bracket round
 * lives on bracket_slots, not on matches, so it needs a follow-up lookup).
 */

import { bracketRoundLabel } from '@myclash/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MatchKind {
  /** 'pool' | 'swiss' | 'play_in' | 'final' | 'semi_final' | 'quarter_final' | 'round_of' | null */
  kind: string | null;
  /** fighter count for kind === 'round_of' (e.g. 16), else null */
  roundOfCount: number | null;
}

/** Normalised match-kind token + (for round_of) the fighter count. */
export function computeMatchKind(
  phaseType: string | null,
  bracketRound: number | null,
  bracketSize: number | null,
): MatchKind {
  if (phaseType === 'pool') return { kind: 'pool', roundOfCount: null };
  if (phaseType === 'swiss') return { kind: 'swiss', roundOfCount: null };
  if (phaseType === 'single_elim' || phaseType === 'double_elim') {
    if (bracketRound === 0) return { kind: 'play_in', roundOfCount: null };
    if (bracketRound != null && bracketRound > 0) {
      const code = bracketRoundLabel(bracketRound, bracketSize);
      if (code === 'F') return { kind: 'final', roundOfCount: null };
      if (code === 'SF') return { kind: 'semi_final', roundOfCount: null };
      if (code === 'QF') return { kind: 'quarter_final', roundOfCount: null };
      const m = /^R(\d+)$/.exec(code);
      return { kind: 'round_of', roundOfCount: m ? Number(m[1]) : null };
    }
  }
  return { kind: null, roundOfCount: null };
}

/** Map of bracket_slot id → round number (empty slotIds → empty map). */
export async function fetchBracketRounds(
  client: SupabaseClient,
  slotIds: string[],
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (slotIds.length === 0) return map;
  const { data } = await client.from('bracket_slots').select('id, round').in('id', slotIds);
  for (const s of Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []) {
    map.set(String(s['id']), (s['round'] as number | null) ?? null);
  }
  return map;
}
