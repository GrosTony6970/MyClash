/**
 * Diff a match's referee role assignments (current vs the modal draft) → the
 * minimal set of `(role, refereeId)` writes to PUT. A role missing from
 * `current` is treated as unassigned (null). `refereeId: null` in the result
 * clears that role.
 *
 * Pure: no React, no I/O.
 */

export interface RoleAssignment {
  role: string;
  refereeId: string | null;
}

export function diffRoleAssignments(
  current: RoleAssignment[],
  draft: RoleAssignment[],
): RoleAssignment[] {
  const currentByRole = new Map(current.map((r) => [r.role, r.refereeId]));
  const out: RoleAssignment[] = [];
  for (const d of draft) {
    const cur = currentByRole.has(d.role) ? currentByRole.get(d.role)! : null;
    if (cur !== d.refereeId) out.push({ role: d.role, refereeId: d.refereeId });
  }
  return out;
}
