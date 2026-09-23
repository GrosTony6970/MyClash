/**
 * Why an emailed claim link did not claim its roster row (operator ruling 57).
 *
 * The link signs its reader in either way — it proved they own the address, which
 * is all the mail tested. The API then sends them to the claim page (or to /me when
 * there is no row to name an Event by) with one of these in the query, and the page
 * says which. The API writes the value; web-public reads it back into a sentence.
 *
 * - `held_by_another` — another account already holds the row.
 * - `email_mismatch` — the row now carries a different address.
 * - `not_found` — no such row, for example deleted after the mail went out.
 * - `check_failed` — the row could not be read, so nothing was decided (ruling 60).
 */
export const CLAIM_LINK_REFUSALS = [
  'held_by_another',
  'email_mismatch',
  'not_found',
  'check_failed',
] as const;

export type ClaimLinkRefusal = (typeof CLAIM_LINK_REFUSALS)[number];

/** The query parameter that carries a `ClaimLinkRefusal`. */
export const CLAIM_REFUSED_PARAM = 'claimRefused';

export function isClaimLinkRefusal(value: string | null | undefined): value is ClaimLinkRefusal {
  return (CLAIM_LINK_REFUSALS as readonly string[]).includes(value ?? '');
}
