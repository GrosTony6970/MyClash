// apps/api/src/modules/staff/live-board.ts

export interface RawBoardMatch {
  id: string;
  lice_id: string;
  status: string;
  red_score: number;
  blue_score: number;
  match_number_label: string | null;
  bracket_slots: { round?: number } | null;
  /**
   * The Swiss round, when this is a Swiss bout. `staff.service.ts` has been
   * selecting `swiss_rounds(round_number)` since the Swiss schema landed, but
   * nothing read it — so every Swiss row on the live board showed no round.
   */
  swiss_rounds?: { round_number?: number } | null;
  red: { persons?: { given_name?: string; family_name?: string } | null } | null;
  blue: { persons?: { given_name?: string; family_name?: string } | null } | null;
}

export interface BoardAccountInput {
  id: string;
  display_name: string;
  last_seen_at: string | null;
  outbox_depth: number | null;
  oldest_pending_age_seconds: number | null;
  rejected_count: number | null;
  needs_attention: boolean;
  needs_attention_reason: 'medic' | 'head_ref' | 'dispute' | null;
}

export interface AssembleInput {
  lices: Array<{ id: string; name: string; sort_order: number }>;
  matches: RawBoardMatch[];
  accounts: BoardAccountInput[];
  assignments: Array<{ staff_account_id: string; lice_id: string }>;
}

export interface BoardMatch {
  id: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  status: string;
  round: number | null;
}
export interface BoardScorer {
  accountId: string;
  name: string;
  lastSeenAt: string | null;
  otherCount: number;
}
export interface BoardHealth {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  rejectedCount: number;
}
export interface BoardAttention {
  reason: 'medic' | 'head_ref' | 'dispute';
}
export interface BoardRow {
  lice: { id: string; name: string; sortOrder: number };
  currentMatch: BoardMatch | null;
  scorer: BoardScorer | null;
  health: BoardHealth | null;
  attention: BoardAttention | null;
  nextUp: { matchId: string; label: string } | null;
}

function fighterName(side: RawBoardMatch['red']): string | null {
  const p = side?.persons;
  if (!p) return null;
  const name = [p.given_name, p.family_name].filter(Boolean).join(' ').trim();
  return name.length ? name : null;
}

export function mapBoardMatch(row: RawBoardMatch): BoardMatch {
  return {
    id: row.id,
    redFighterName: fighterName(row.red),
    blueFighterName: fighterName(row.blue),
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
  };
}

export function assembleBoardRows(input: AssembleInput): BoardRow[] {
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));

  return input.lices
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((lice) => {
      const liceMatches = input.matches.filter((m) => m.lice_id === lice.id);
      const currentRaw =
        liceMatches.find((m) => m.status === 'running' || m.status === 'paused') ??
        liceMatches.find((m) => m.status === 'scheduled') ??
        null;
      const currentMatch = currentRaw ? mapBoardMatch(currentRaw) : null;

      const nextRaw = liceMatches.find((m) => m.status === 'scheduled' && m.id !== currentRaw?.id);
      const nextUp = nextRaw
        ? { matchId: nextRaw.id, label: nextRaw.match_number_label ?? '' }
        : null;

      const assigned = input.assignments
        .filter((a) => a.lice_id === lice.id)
        .map((a) => accountById.get(a.staff_account_id))
        .filter((a): a is BoardAccountInput => Boolean(a))
        .sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''));
      const primary = assigned[0] ?? null;

      const scorer: BoardScorer | null = primary
        ? {
            accountId: primary.id,
            name: primary.display_name,
            lastSeenAt: primary.last_seen_at,
            otherCount: assigned.length - 1,
          }
        : null;

      // Health is UNKNOWN unless the tablet has reported at least one metric.
      const health: BoardHealth | null =
        primary && primary.outbox_depth !== null
          ? {
              outboxDepth: primary.outbox_depth ?? 0,
              oldestPendingAgeSec: primary.oldest_pending_age_seconds ?? 0,
              rejectedCount: primary.rejected_count ?? 0,
            }
          : null;

      const attention: BoardAttention | null =
        primary && primary.needs_attention && primary.needs_attention_reason
          ? { reason: primary.needs_attention_reason }
          : null;

      return {
        lice: { id: lice.id, name: lice.name, sortOrder: lice.sort_order },
        currentMatch,
        scorer,
        health,
        attention,
        nextUp,
      };
    });
}
