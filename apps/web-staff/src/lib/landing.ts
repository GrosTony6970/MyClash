import { parseStaffRole, type StaffRole } from '@myclash/types';
import { PISTES_ON_ARRIVAL } from './last-piste';

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
 * Unknown or missing role falls back to the piste list, matching
 * `parseStaffRole`: a bare staff account has always meant a scoring account, so
 * a row written before 0173's CHECK constraint must not strand its holder on a
 * blank page.
 */
export function landingPathForRole(role: unknown): string {
  const parsed: StaffRole = parseStaffRole(role);
  if (parsed === 'checkin') return '/desk';
  if (parsed === 'gear') return '/gear';
  return '/lices';
}

/**
 * Where a staff account lands right AFTER it signed in. The same screen as
 * `landingPathForRole`; the piste list is told that this is an arrival, so it
 * opens the last piste at once (`last-piste.ts`). A redirect of a wrong screen
 * is not an arrival, and keeps the plain path.
 */
export function arrivalPathForRole(role: unknown): string {
  const landing = landingPathForRole(role);
  return landing === '/lices' ? PISTES_ON_ARRIVAL : landing;
}
