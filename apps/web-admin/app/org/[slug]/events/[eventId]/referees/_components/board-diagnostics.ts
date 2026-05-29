/**
 * Pure aggregators that turn a referee assignment-board projection into
 * the counts the AssignmentDiagnosticsPanel renders. Kept dependency-free
 * (no React, no @myclash/ui) so the helpers can be unit-tested in
 * isolation and reused if the board projection ever moves server-side.
 */

interface BoardLike {
  pools: Array<{
    roleSlots: Array<{
      role: string;
      assignment: unknown | null;
      missingReasons: string[];
    }>;
  }>;
}

export interface BoardSummary {
  totalSlots: number;
  filledSlots: number;
  byReason: Record<string, number>;
}

export function summariseBoard(board: BoardLike): BoardSummary {
  let totalSlots = 0;
  let filledSlots = 0;
  const byReason: Record<string, number> = {};
  for (const pool of board.pools) {
    for (const slot of pool.roleSlots) {
      totalSlots += 1;
      if (slot.assignment) filledSlots += 1;
      for (const reason of slot.missingReasons) {
        byReason[reason] = (byReason[reason] ?? 0) + 1;
      }
    }
  }
  return { totalSlots, filledSlots, byReason };
}

interface RosterBoardLike extends BoardLike {
  candidates: Array<{
    personId: string;
    qualifications: Array<{ role: string; rating: number | null }>;
  }>;
}

export interface SkillHealth {
  skillId: string;
  skillName: string;
  slotsOpen: number;
  qualifiedCount: number;
  /** max(0, slotsOpen - qualifiedCount) — supply shortage. */
  shortBy: number;
}

export function summariseRosterHealth(
  board: RosterBoardLike,
  skillNameById: Map<string, string>,
): SkillHealth[] {
  const slotsOpenBySkill = new Map<string, number>();
  for (const pool of board.pools) {
    for (const slot of pool.roleSlots) {
      if (slot.assignment) continue;
      slotsOpenBySkill.set(slot.role, (slotsOpenBySkill.get(slot.role) ?? 0) + 1);
    }
  }

  const qualifiedBySkill = new Map<string, Set<string>>();
  for (const candidate of board.candidates) {
    for (const q of candidate.qualifications) {
      const set = qualifiedBySkill.get(q.role) ?? new Set<string>();
      set.add(candidate.personId);
      qualifiedBySkill.set(q.role, set);
    }
  }

  const out: SkillHealth[] = [];
  for (const [skillId, slotsOpen] of slotsOpenBySkill) {
    const qualifiedCount = qualifiedBySkill.get(skillId)?.size ?? 0;
    out.push({
      skillId,
      skillName: skillNameById.get(skillId) ?? skillId,
      slotsOpen,
      qualifiedCount,
      shortBy: Math.max(0, slotsOpen - qualifiedCount),
    });
  }
  return out;
}
