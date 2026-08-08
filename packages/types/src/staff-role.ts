/**
 * Event staff roles — which job a local PIN account does on the event day.
 *
 *   scoring   The piste. Runs the scoring pad on the Lices assigned to the
 *             account. This is what every staff account was before roles
 *             existed, and it is the default.
 *   checkin   The check-in desk. Marks fighters as arrived. No piste.
 *   gear      The gear-check table. Records a per-weapon equipment pass.
 *             No piste.
 *
 * ## Why this is not in the token
 *
 * The `mc_staff` JWT is `{ sub, event_id, type: 'staff' }` and carries no role.
 * That is deliberate and must stay that way: the role is read from the account
 * row on every request, so an organiser fixing a mis-configured volunteer at
 * 09:05 takes effect on the next tap rather than at the volunteer's next login.
 * A session that outlives the event day would otherwise pin a stale role for
 * the whole event.
 *
 * ## Not a rank
 *
 * Unlike {@link PlatformRole} these do not nest — a `gear` account is not a
 * weaker `scoring` account, it is a different job. There is no rank order and
 * no "at least" comparison; a surface names the exact roles it accepts.
 *
 * ## Piste assignment only means something for `scoring`
 *
 * `event_staff_lice_assignments` is the piste-scoped gate on scoring writes.
 * A `checkin` or `gear` account has no assignment and never will, so their
 * surfaces gate EVENT-scoped on this role instead. Rendering an assignment
 * control for them would imply a boundary that does not exist — which is
 * exactly what earned migration 0168.
 *
 * The module is pure — no I/O, no React, no Node-only APIs — so the NestJS API,
 * the staff PWA and the admin app share one definition.
 */

/**
 * Ordered as the admin tabs read, left to right. `scoring` is first because it
 * is the default and by far the largest population at any event.
 */
export const STAFF_ROLES = ['scoring', 'checkin', 'gear'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Coerce an unknown value (a PostgREST row, a login response) to a StaffRole.
 *
 * Falls back to `scoring` rather than to null: the column is NOT NULL with a
 * `scoring` default, so an unrecognised value means a row written before the
 * CHECK constraint or by hand — and the historical meaning of a bare staff
 * account is a scoring account. Returning null instead would make every caller
 * invent its own fallback.
 */
export function parseStaffRole(value: unknown): StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value as string)
    ? (value as StaffRole)
    : 'scoring';
}

/** Whether this role runs a piste, i.e. whether Lice assignment applies to it. */
export function staffRoleUsesLices(role: StaffRole): boolean {
  return role === 'scoring';
}
