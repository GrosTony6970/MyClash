import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import { hasBeenFought } from '../matches/fought-match';
import { buildSelfRef, type PhaseConfig } from './bracket-refs';
import { loadMatch, loadPhase, loadSlot } from './bracket-downstream';

/**
 * "Everything downstream of this match, transitively", answered once.
 *
 * `downstreamSlots` answers one level. That is the right answer for advancement,
 * which runs again at each level as each bout completes. It is the wrong answer
 * for anything that UN-does a result: clearing only the first level leaves every
 * deeper slot still holding the registration its now-cleared parent propagated,
 * and `advanceFromSlot` writes a side only while it is null — so the stale-side
 * bug simply reappears one round further along.
 *
 * THREE THINGS THIS GETS RIGHT THAT A NAIVE RECURSION DOES NOT.
 *
 * 1. Deduplication, keyed on SLOT ID. Double elimination is a DAG with
 *    systemic reconvergence, not a tree: the loser edge out of WB round r and
 *    the winner edge out of the matching LB round land on the same mixed LB
 *    slot. Walking a 128-fighter bracket from WBR1P1 without a visited set
 *    reaches 21 distinct nodes in 71 visits and arrives at the grand final 8
 *    separate times. Reconvergence is normal, so a repeat visit is skipped
 *    quietly — but every per-node action would otherwise run up to 8 times.
 *
 *    Never key the set on the selfRef string. `buildSelfRef` collapses position
 *    for 'GF' and collapses both round and position for 'GFRESET', so two slots
 *    can legitimately stamp the same ref.
 *
 * 2. Deepest-first as a REVERSE-TOPOLOGICAL order, computed from
 *    `bracket_slots.round`, not from recursion depth. On a reconvergent DAG the
 *    same node sits at two different depths — the grand final is 3 hops away up
 *    the winners chain and 15 up the losers chain — so a depth-keyed sort is not
 *    a dependency order. Round is, because every edge strictly increases it.
 *
 * 3. Voided matches are excluded. Migration 0094 deliberately parks voided rows
 *    outside `matches_bracket_slot_id_active_uniq` so a replayed slot can carry
 *    a fresh live row beside its voided history. A caller that reverted one of
 *    those to 'scheduled' would raise a 23505 against that index.
 *
 * Five reads regardless of bracket size: every dependent is in the same phase
 * (`downstreamSlots` filters on `phase_id`), so the slot table and the live
 * matches are fetched once and the walk runs in memory.
 */

type Client = SupabaseService['service'];

/**
 * Bounds the walk against corrupt data. The real maximum is
 * wbRounds + lbRounds + 2 = 21 for the largest supported double elimination
 * (128, gold, with the reset), and 8 for the largest single elimination — so 32
 * is slack, not a limit anyone legitimately reaches.
 *
 * Acyclicity is a property of the GENERATOR and nothing else: `bracket_slots`
 * constrains only (phase_id, round, position), `source_*_ref` are unconstrained
 * nullable text, and archive restore writes them verbatim out of an uploaded
 * buffer with no per-row validation. A self-loop is one hand-edited line away.
 */
const MAX_DEPTH = 32;

export interface DependentBout {
  slotId: string;
  round: number;
  /** The slot's live (non-voided) matches row, when it has one. */
  matchId: string | null;
  status: string | null;
  startedAt: string | null;
  lockedAt: string | null;
  label: string | null;
  /**
   * The bout carries a result or is mid-fight, so un-doing its parent cannot
   * silently discard it. Same predicate as `hasStarted` in bracket-match-sync.
   */
  hasBeenFought: boolean;
}

interface SlotRow {
  id: string;
  round: number;
  position: number;
  source_a_ref: string | null;
  source_b_ref: string | null;
}

interface MatchRow {
  id: string;
  bracket_slot_id: string;
  status: string;
  started_at: string | null;
  locked_at: string | null;
  match_number_label: string | null;
}

const fought = hasBeenFought;

/**
 * Every bout downstream of `matchId`, deepest round first.
 *
 * Empty for a pool or Swiss match, which feeds no slot, and for a bracket leaf
 * whose slot feeds nothing.
 */
export async function dependentClosure(
  supabase: Client,
  matchId: string,
): Promise<DependentBout[]> {
  const graph = await loadPhaseGraph(supabase, matchId);
  if (!graph) return [];
  return walk(graph);
}

interface PhaseGraph {
  phaseId: string;
  phaseType: string;
  config: PhaseConfig;
  rootSlot: { id: string; round: number; position: number };
  slots: SlotRow[];
  liveMatch: Map<string, MatchRow>;
}

/**
 * The whole phase in five reads, because every dependent is in it.
 *
 * `downstreamSlots` resolves successors with `.eq('phase_id', slot.phase_id)`,
 * so the transitive closure cannot leave the phase either. Fetching the slot
 * table and its live matches once turns a per-node round trip into an in-memory
 * walk — 5 reads for a 128-fighter double elimination instead of 63.
 */
async function loadPhaseGraph(supabase: Client, matchId: string): Promise<PhaseGraph | null> {
  const root = await loadMatch(supabase, matchId);
  if (!root?.bracket_slot_id) return null;
  const rootSlot = await loadSlot(supabase, root.bracket_slot_id);
  if (!rootSlot) return null;
  const phase = await loadPhase(supabase, rootSlot.phase_id);
  if (!phase) return null;

  const { data: slotData } = await supabase
    .from('bracket_slots')
    .select('id, round, position, source_a_ref, source_b_ref')
    .eq('phase_id', rootSlot.phase_id);
  const slots = (slotData ?? []) as SlotRow[];
  if (slots.length === 0) return null;

  const { data: matchData } = await supabase
    .from('matches')
    .select('id, bracket_slot_id, status, started_at, locked_at, match_number_label')
    .in(
      'bracket_slot_id',
      slots.map((slot) => slot.id),
    )
    .not('status', 'eq', 'voided');
  const liveMatch = new Map<string, MatchRow>();
  for (const row of (matchData ?? []) as MatchRow[]) liveMatch.set(row.bracket_slot_id, row);

  return {
    phaseId: rootSlot.phase_id,
    phaseType: phase.type as string,
    config: (phase.config_json ?? {}) as PhaseConfig,
    rootSlot,
    slots,
    liveMatch,
  };
}

/** Breadth-first over the ref graph, one visit per slot, deepest round first. */
function walk({ phaseId, phaseType, config, rootSlot, slots, liveMatch }: PhaseGraph) {
  const visited = new Set<string>([rootSlot.id]);
  const found: DependentBout[] = [];

  // Only the root's OWN ref matters for the first hop — what feeds it is
  // upstream, and upstream is not what an un-completion invalidates.
  let frontier = [{ round: rootSlot.round, position: rootSlot.position }];
  for (let depth = 0; frontier.length > 0; depth++) {
    if (depth > MAX_DEPTH) {
      throw new BadRequestException(
        `Bracket dependency walk exceeded ${MAX_DEPTH} rounds in phase ${phaseId} — the slot graph has a cycle`,
      );
    }
    const next: SlotRow[] = [];
    for (const from of frontier) {
      const selfRef = buildSelfRef(from.round, from.position, phaseType, config);
      for (const slot of slots) {
        if (visited.has(slot.id)) continue;
        if (!isFedBy(slot, selfRef)) continue;
        visited.add(slot.id);
        found.push(toBout(slot, liveMatch.get(slot.id) ?? null));
        next.push(slot);
      }
    }
    frontier = next;
  }

  // Reverse-topological: every edge strictly increases the absolute round, so
  // descending round is a valid dependency order and the same node cannot sit
  // in two positions the way recursion depth would place it.
  return found.sort((a, b) => b.round - a.round);
}

/** Both edges, never just the winner — a bronze match hangs off `loser of`. */
function isFedBy(slot: SlotRow, selfRef: string): boolean {
  const refs = [`winner of ${selfRef}`, `loser of ${selfRef}`];
  return refs.includes(slot.source_a_ref ?? '') || refs.includes(slot.source_b_ref ?? '');
}

function toBout(slot: SlotRow, match: MatchRow | null): DependentBout {
  return {
    slotId: slot.id,
    round: slot.round,
    matchId: match?.id ?? null,
    status: match?.status ?? null,
    startedAt: match?.started_at ?? null,
    lockedAt: match?.locked_at ?? null,
    label: match?.match_number_label ?? null,
    hasBeenFought: match ? fought(match.status, match.started_at) : false,
  };
}

/**
 * Take the fighters back off a dependent bout's `matches` row.
 *
 * `clearDownstreamOf` nulls the SLOT sides and stops there, on the strength of a
 * comment saying `writeSlotSide` overwrites the row on the way back in. That
 * stopped being true: `writeSlotSide` is slot-only since the refactor that gave
 * `syncMatchToSlot` sole ownership of the row, and the row is now rewritten only
 * if a re-completion with a winner ever happens.
 *
 * So between un-completing a bout and completing it again, the dependent row
 * keeps naming the pair its old result produced. The schedule grid, the live
 * board, the public schedule and the pad all show them, and `clockAction`
 * validates nothing against the slot — a referee can start a bout between two
 * fighters who have not earned it. Nulling the row is what makes the interim
 * state honest: an empty bout that is waiting on its feeder.
 */
export async function clearDependentPairing(supabase: Client, matchId: string): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({ red_registration_id: null, blue_registration_id: null })
    .eq('id', matchId);
  if (error) throw new BadRequestException(error.message);
}
