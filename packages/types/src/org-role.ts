/**
 * The club roles, lowest to highest: a role satisfies every role before it.
 *
 * The one owner of the club-role order. The API's authorisation reads it (`assertOrgRole`,
 * through `roleAtLeast`), and so does the organiser menu, which hides an entry its reader's role
 * cannot open (ruling 893): two copies would let the menu and the API disagree on who sees what.
 */
export const ORG_ROLE_ORDER = [
  'read_only',
  'scorekeeper',
  'referee',
  'workshop_lead',
  'editor',
  'admin',
  'owner',
] as const;

export type OrgRole = (typeof ORG_ROLE_ORDER)[number];

/**
 * Whether `role` is `min` or above. The column is TEXT with no CHECK, so a role the order does not
 * hold loses every bar, and a bar it does not hold lets no one through.
 */
export function roleAtLeast(role: string | null | undefined, min: OrgRole): boolean {
  const bar = ORG_ROLE_ORDER.indexOf(min);
  return bar !== -1 && ORG_ROLE_ORDER.indexOf(role as OrgRole) >= bar;
}

/** Every role that is `min` or above: `roleAtLeast` as a list, for a query's `in`. */
export function rolesAtLeast(min: OrgRole): OrgRole[] {
  return ORG_ROLE_ORDER.slice(ORG_ROLE_ORDER.indexOf(min));
}
