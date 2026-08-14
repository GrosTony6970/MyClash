/**
 * One directory row, shaped once for two renderers.
 *
 * The directory is a real `<table>` at `md`+ and a card list below it, because
 * DESIGN.md's reader is holding a phone in a sports hall. Two renderings of one
 * row are two chances to disagree — a column that formats a country one way in
 * the table and another on the card is a bug nobody sees until they rotate their
 * phone. Both branches consume THIS, and a test asserts they are handed
 * identical data.
 *
 * Presentation is duplicated on purpose (a table cell and a card line are not
 * the same markup); the data is not.
 *
 * Pure and dependency-free: no React, no i18n, no `Intl` — the locale-dependent
 * country NAME is resolved by the renderer, which knows the reader's locale.
 * This module decides what a row IS, not how it reads.
 */

/** The API's directory row, as `GET /fighters/public` returns it. */
export interface DirectoryApiFighter {
  id: string;
  slug: string;
  displayName: string;
  givenName: string;
  familyName: string;
  photoUrl: string | null;
  countryCode: string | null;
  clubName: string | null;
  clubSlug: string | null;
  weapons: string[];
}

export interface FighterRowModel {
  id: string;
  /** Where the whole row links. */
  href: string;
  name: string;
  /** Feeds the avatar's initials fallback; the API may send an empty name. */
  initialsSource: string;
  photoUrl: string | null;
  clubName: string | null;
  /** Present only when the club has a public page to link to. */
  clubHref: string | null;
  countryCode: string | null;
  weapons: string[];
}

/** `null` for anything blank, so a renderer never prints an empty string. */
function orNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function toFighterRowModel(fighter: DirectoryApiFighter): FighterRowModel {
  // displayName is NOT NULL in the schema, but a row imported with a blank one
  // would render as an empty link with no target for a screen reader to
  // announce. Fall back through the name parts before giving up.
  const composed = [fighter.givenName, fighter.familyName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const name = orNull(fighter.displayName) ?? orNull(composed) ?? fighter.slug;

  return {
    id: fighter.id,
    href: `/fighters/${fighter.slug}`,
    name,
    initialsSource: name,
    photoUrl: orNull(fighter.photoUrl),
    clubName: orNull(fighter.clubName),
    // No slug means no public club page; linking to `/clubs/` would 404.
    clubHref: fighter.clubSlug ? `/clubs/${fighter.clubSlug}` : null,
    countryCode: orNull(fighter.countryCode),
    weapons: fighter.weapons.map((w) => w.trim()).filter(Boolean),
  };
}

export function toFighterRowModels(fighters: DirectoryApiFighter[]): FighterRowModel[] {
  return fighters.map(toFighterRowModel);
}
