/**
 * Platform roles — authority over the platform itself, above and outside any
 * organisation.
 *
 *   super_admin      Everything. The reserve: minting and deleting platform
 *                    accounts, granting platform roles, revealing and resetting
 *                    passwords, backups and restore, restart/redeploy, TLS
 *                    renewal, the lockdown and read-only kill switches, the
 *                    platform AI keys and budget, and every GDPR operation.
 *   platform_admin   Platform moderation and catalogue work: organisations
 *                    (create, suspend, approve, reassign owner), every review
 *                    queue, custom rulesets, the weapon catalogue, club
 *                    moderation, HEMA Ratings sync, league management, fighter
 *                    merges, AI data-quality scans. Reads everything an admin
 *                    can act on, plus runtime health and system versions.
 *   platform_viewer  Reads the console. Cannot mutate anything, anywhere.
 *
 * ## Mutually exclusive, structurally
 *
 * `platform_roles.user_id` is the PRIMARY KEY, so a user holds at most one of
 * these. That is not an application rule that could drift — it is the table's
 * shape. Changing a tier is an UPDATE (or an upsert on the PK), never a second
 * INSERT.
 *
 * ## Why `platform_viewer` and not `platform_read_only`
 *
 * `read_only` is already an `organization_members.role`, and `read_only_mode`
 * is already a feature flag that stops all writes platform-wide. Three
 * unrelated "read only" concepts would collide for every future grep and would
 * render the same word for two different meanings on adjacent tabs of the
 * accounts console. The stored identifier is `platform_viewer`; the UI label
 * stays "Read-only", via i18n.
 *
 * ## This is not the RLS boundary
 *
 * SQL `is_super_admin()` is unchanged and still means exactly `super_admin`.
 * Every `platform_admin` capability is exercised through the API's service-role
 * connection, so a `platform_admin` holding a raw `authenticated` JWT gains
 * nothing at the Postgres level beyond reading their own `platform_roles` row.
 * Widening `is_super_admin()` would grant writes across ~80 policies — never do
 * it to accommodate a new tier.
 *
 * The module is pure — no I/O, no React, no Node-only APIs — so the NestJS API
 * and all three Next apps share one definition.
 */

/** Ordered weakest-first is deliberate: the array doubles as the rank order. */
export const PLATFORM_ROLES = ['platform_viewer', 'platform_admin', 'super_admin'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Higher wins. Only ever compared, never stored or serialised. */
export const PLATFORM_ROLE_RANK: Record<PlatformRole, number> = {
  platform_viewer: 1,
  platform_admin: 2,
  super_admin: 3,
};

/**
 * Coerce an unknown value (a PostgREST row, a JSON payload) to a PlatformRole.
 *
 * Anything unrecognised — null, undefined, a typo, an org role that wandered in
 * — becomes `null`, meaning "holds no platform role". The direction matters:
 * `platform_roles.role` only got its CHECK constraint in migration 0170, so a
 * row written before it, or by hand, must resolve to no authority rather than
 * be coerced up into one.
 */
export function parsePlatformRole(value: unknown): PlatformRole | null {
  return (PLATFORM_ROLES as readonly string[]).includes(value as string)
    ? (value as PlatformRole)
    : null;
}

/**
 * Whether `held` satisfies a minimum tier. `null` — no platform role at all —
 * never satisfies anything.
 */
export function atLeastPlatformRole(held: PlatformRole | null, min: PlatformRole): boolean {
  if (held === null) return false;
  return PLATFORM_ROLE_RANK[held] >= PLATFORM_ROLE_RANK[min];
}

/**
 * Whether the holder may act on the platform at all, as opposed to only reading
 * it. Named separately from `atLeastPlatformRole(held, 'platform_admin')`
 * because it answers a different question — "is this a mutation-capable
 * account" — and the two would drift apart the day a fourth tier appears.
 */
export function canMutatePlatform(held: PlatformRole | null): boolean {
  return atLeastPlatformRole(held, 'platform_admin');
}
