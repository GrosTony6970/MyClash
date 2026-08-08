import { parseStaffRole, type StaffRole } from '@myclash/types';

/**
 * Where a staff account lands after signing in.
 *
 * One door, three destinations — the role picks which. A check-in volunteer
 * dropped on the piste list would see an empty screen (they have no Lice
 * assignment and never will) and no way to guess where their actual job lives.
 *
 * The role comes from the login response's `account.role`, NOT from the
 * mc_staff token, which carries none. See `staff-role.ts` for why that is
 * deliberate.
 *
 * `gear` currently lands on the piste list because the gear-check surface does
 * not exist yet. That is an empty-but-working screen rather than a 404, and it
 * is one line to change when the surface ships. Unknown or missing role falls
 * back the same way, matching `parseStaffRole`: a bare staff account has always
 * meant a scoring account.
 */
export function landingPathForRole(role: unknown): string {
  const parsed: StaffRole = parseStaffRole(role);
  if (parsed === 'checkin') return '/desk';
  return '/lices';
}
