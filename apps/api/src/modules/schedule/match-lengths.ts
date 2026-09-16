import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchWindowMs, type TimeWindowMs } from '@myclash/schedule-core';
import { readProgrammeSheet } from '../programme/programme-sheet';
import {
  finalRoundsByPhase,
  matchKind,
  plannedLengthOf,
  sheetLengthFor,
  type BracketRoundRow,
} from './planned-length';

/**
 * Every reader's one way to ask how long a Match is planned to take (ADR-018).
 *
 * Before this, each reader answered for itself and most of them guessed: a
 * hard-coded five minutes in the referee board and the conflict check, a
 * `?? 10` in the scheduler, a bar's kind standing in for its Matches'. The
 * organiser types the lengths on the Event's planner sheet, and there is now
 * one path from that sheet to a number.
 *
 * Plain functions taking `db`, not a Nest provider. `readProgrammeSheet` and
 * `planned-length.ts` already cross module boundaries this way, `SupabaseModule`
 * is `@Global()`, and a provider would add a module edge for nothing.
 *
 * No authorization: every caller decides who may read before it calls, exactly
 * as `readProgrammeSheet` does.
 */

/** What the caller must know about a Match to get its length. */
export interface MatchLengthInput {
  id: string;
  phaseId: string;
  /** The Match's own number, which beats the sheet. Null when it has none. */
  plannedDurationOverrideMinutes: number | null;
}

/** A Match with a time, for the window form. */
export interface MatchWindowInput extends MatchLengthInput {
  scheduledAt: string | null;
}

/** A Match's planned window, plus the length it was built from. */
export interface MatchWindow extends TimeWindowMs {
  durationMinutes: number;
}

interface PhaseRow {
  id: string;
  type: string | null;
  tournament_id: string;
}

/**
 * PostgREST projects a one-to-one embed either as an object or as a
 * single-element array depending on the joined cardinality it infers. Both
 * shapes reach here for the same query, so both are read.
 */
type EmbeddedSlot = { round: number | null } | Array<{ round: number | null }> | null;

function roundOf(slot: EmbeddedSlot): number | null {
  const one = Array.isArray(slot) ? (slot[0] ?? null) : slot;
  return one?.round ?? null;
}

const BRACKET_TYPES = new Set(['single_elim', 'double_elim']);

/**
 * Every bracket Match's round, and each bracket's final round.
 *
 * One read for both. A bracket Match's kind depends on its own round AND on the
 * highest round its phase actually holds, so the rows of the whole phase are
 * needed either way — `.not('bracket_slot_id', 'is', null)` keeps out the ones
 * that have no round to contribute.
 */
async function readBracketRounds(
  db: SupabaseClient,
  bracketPhaseIds: readonly string[],
): Promise<{ roundByMatch: Map<string, number | null>; finalRounds: Map<string, number | null> }> {
  const roundByMatch = new Map<string, number | null>();
  if (bracketPhaseIds.length === 0) return { roundByMatch, finalRounds: new Map() };

  const { data, error } = await db
    .from('matches')
    .select('id, phase_id, bracket_slots(round)')
    .in('phase_id', bracketPhaseIds)
    .not('bracket_slot_id', 'is', null);
  if (error) throw new BadRequestException(error.message);

  const rows: BracketRoundRow[] = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    phase_id: string;
    bracket_slots: EmbeddedSlot;
  }>) {
    const round = roundOf(row.bracket_slots);
    roundByMatch.set(row.id, round);
    rows.push({ phase_id: row.phase_id, round });
  }
  return { roundByMatch, finalRounds: finalRoundsByPhase(rows) };
}

/**
 * Each Match's planned length in minutes, keyed by Match id.
 *
 * Three reads at most, whatever the batch size: the Event's sheet, the phases
 * the Matches sit in, and — only when a bracket is among them — the Matches of
 * those bracket phases, whose rounds decide which of them are finals. An empty
 * batch reads nothing.
 *
 * Throws `BadRequestException` when a read fails or a Match names a phase that
 * does not exist: a length invented for a Match whose phase is unknown is the
 * class of defect this helper replaces.
 */
export async function resolveMatchLengths(
  db: SupabaseClient,
  eventId: string,
  inputs: readonly MatchLengthInput[],
): Promise<Map<string, number>> {
  if (inputs.length === 0) return new Map();

  const sheet = await readProgrammeSheet(db, eventId);

  const phaseIds = [...new Set(inputs.map((input) => input.phaseId))];
  const phasesRes = await db.from('phases').select('id, type, tournament_id').in('id', phaseIds);
  if (phasesRes.error) throw new BadRequestException(phasesRes.error.message);
  const phases = new Map(((phasesRes.data ?? []) as PhaseRow[]).map((phase) => [phase.id, phase]));

  for (const id of phaseIds) {
    // A loop, not `find` + truthiness: `find` returns the VALUE, so `undefined`
    // and `''` both read as "nothing missing" — and `undefined` is exactly what
    // a caller that omits a phase for a Match that does not exist yet produces.
    // The guard has to fire on the values that break the next line.
    if (!phases.has(id)) throw new BadRequestException(`Match phase ${id} does not exist`);
  }

  const bracketPhaseIds = phaseIds.filter((id) => BRACKET_TYPES.has(phases.get(id)?.type ?? ''));
  const { roundByMatch, finalRounds } = await readBracketRounds(db, bracketPhaseIds);

  return new Map(
    inputs.map((input) => {
      if (input.plannedDurationOverrideMinutes != null) {
        return [input.id, input.plannedDurationOverrideMinutes];
      }
      // Present: the loop above threw for any phase id the read did not answer.
      const phase = phases.get(input.phaseId) as PhaseRow;
      const kind = matchKind(
        phase.type,
        roundByMatch.get(input.id) ?? null,
        finalRounds.get(input.phaseId) ?? null,
      );
      return [input.id, sheetLengthFor(kind, sheet, phase.tournament_id)];
    }),
  );
}

/**
 * Each Match's planned window, keyed by Match id. A Match with no time has no
 * window and maps to null — it is planned but not placed.
 *
 * The window is half-open and comes from `matchWindowMs`, which refuses a start
 * it cannot read rather than returning a window that overlaps nothing. Callers
 * that place Matches validate the time before calling, so a throw here is a
 * server fault.
 */
export async function resolveMatchWindows(
  db: SupabaseClient,
  eventId: string,
  inputs: readonly MatchWindowInput[],
): Promise<Map<string, MatchWindow | null>> {
  const lengths = await resolveMatchLengths(db, eventId, inputs);
  return new Map(
    inputs.map((input) => {
      if (input.scheduledAt == null) return [input.id, null];
      // A length is never missing here — the helper answers for every input —
      // and a missing one must not read as "no window", which overlaps nothing.
      const durationMinutes = plannedLengthOf(lengths, input.id);
      return [input.id, { durationMinutes, ...matchWindowMs(input.scheduledAt, durationMinutes) }];
    }),
  );
}
