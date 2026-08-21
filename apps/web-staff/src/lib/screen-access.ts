import { parseStaffRole, type StaffRole } from '@myclash/types';
import { landingPathForRole } from './landing';

/**
 * May the account holding this session work THIS screen?
 *
 * ── The gap it closes ───────────────────────────────────────────────────────
 * `landingPathForRole` sends each role to its own screen after sign-in, and
 * that was the whole of the app's role logic. Nothing stopped a session
 * reaching another screen by URL or bookmark — so on 2026-08-21 a `checkin`
 * account opened /gear, got the full interface, and every call it made answered
 * 403 `Staff account role cannot use this surface`. The roster read too, so the
 * screen showed an empty list and a red line and named neither cause.
 *
 * ── It is a courtesy, never a boundary ──────────────────────────────────────
 * The API refuses on its own (`GEAR_ROLES` in gear.service.ts, `SCORING_ROLES`
 * in staff.service.ts) and stays the only thing that decides. This exists so
 * the refusal is legible before the volunteer taps, not to enforce anything —
 * which is why every uncertainty below resolves to `allow`.
 *
 * ── Why a null role is allowed through ──────────────────────────────────────
 * Two callers pass one, and both must pass:
 *
 *   1. An ORGANISER on the pad. `resolveStaffSession` admits a claimed account
 *      session with no PIN, and such a session has no staff role at all — the
 *      API authorises it by org role instead. Refusing here would re-create the
 *      bug that file was written to fix, where every organiser without a PIN
 *      was bounced to /login holding a valid session.
 *   2. A pad that could not READ its session. Offline scoring is hard rule 3:
 *      a screen that blanks itself because a `/staff-auth/me` fetch failed on
 *      venue wifi is worse than one that lets the API refuse a write it was
 *      never going to accept.
 *
 * A legacy row with an unrecognised role resolves to `scoring` through
 * `parseStaffRole`, matching `landingPathForRole` — so its holder is allowed on
 * the piste screens and sent there from the others, rather than stranded.
 */
export type ScreenAccess =
  /** Render the screen. Also every uncertain case — see above. */
  | { kind: 'allow' }
  /** A staff account whose role works a different screen. */
  | { kind: 'wrong_role'; landingPath: string };

export function resolveScreenAccess(
  /** The role this screen needs. */
  required: StaffRole,
  /**
   * `account.role` from `GET /api/v1/staff-auth/me`, or `null` when there is no
   * staff PIN session behind this request — or none read yet.
   */
  staffRole: unknown | null,
): ScreenAccess {
  if (staffRole === null || staffRole === undefined) return { kind: 'allow' };
  const held = parseStaffRole(staffRole);
  return held === required
    ? { kind: 'allow' }
    : { kind: 'wrong_role', landingPath: landingPathForRole(held) };
}
