/**
 * legal.ts — the versioned registry of the documents a user agrees to.
 *
 * The TEXT lives on the marketing site (`apps/web-marketing/public/terms`,
 * `.../privacypolicy`, with `/en/...` siblings). It is already written, already
 * indexed, and has no build step to fight. What the database stores is only
 * *who accepted which version, when* — so this file is the single place that
 * says what "the current version" is.
 *
 * `version` is the document's own "Last updated" date, not a serial. It must
 * match the text that is actually published — a version string that has drifted
 * from the page means every stored acceptance points at a document nobody can
 * produce.
 *
 * **Bumping a version is a user-visible act.** Every account whose latest
 * acceptance is older then shows up in `pendingLegal` on `GET /api/v1/me` and
 * is asked to re-accept. Change it when the published text changes, and not to
 * fix a typo in a heading.
 */

export type LegalDocumentKind = 'terms' | 'privacy';

/** Iteration order for anything that must cover every document. */
export const LEGAL_DOCUMENT_KINDS = ['terms', 'privacy'] as const;

export interface LegalPolicy {
  readonly kind: LegalDocumentKind;
  /** The published "Last updated" date, ISO `YYYY-MM-DD`. */
  readonly version: string;
  /**
   * Path on the marketing origin, per locale. French is at the root and English
   * under `/en` — that is how the static site is laid out, not a preference.
   */
  readonly path: {
    readonly en: string;
    readonly fr: string;
  };
}

export const LEGAL_POLICIES: Readonly<Record<LegalDocumentKind, LegalPolicy>> = {
  terms: {
    kind: 'terms',
    version: '2026-05-13',
    path: { en: '/en/terms', fr: '/terms' },
  },
  privacy: {
    kind: 'privacy',
    version: '2026-05-13',
    path: { en: '/en/privacypolicy', fr: '/privacypolicy' },
  },
};

/** The versions a client must echo back for its acceptance to be recorded. */
export function currentLegalVersions(): Record<LegalDocumentKind, string> {
  return {
    terms: LEGAL_POLICIES.terms.version,
    privacy: LEGAL_POLICIES.privacy.version,
  };
}

/**
 * Is this the version currently published? The server asks this before storing
 * an acceptance, so a client running a cached bundle cannot record agreement to
 * a document that has since been revised — it gets a 400 and reloads instead.
 */
export function isLegalVersionCurrent(kind: LegalDocumentKind, version: string): boolean {
  return LEGAL_POLICIES[kind].version === version;
}

/**
 * Absolute URL of a policy on the marketing origin. Unknown locales fall back
 * to English rather than 404ing on a path that does not exist.
 */
export function legalPolicyUrl(
  kind: LegalDocumentKind,
  locale: string,
  marketingOrigin: string,
): string {
  const policy = LEGAL_POLICIES[kind];
  const path = locale === 'fr' ? policy.path.fr : policy.path.en;
  return `${marketingOrigin.replace(/\/+$/, '')}${path}`;
}
