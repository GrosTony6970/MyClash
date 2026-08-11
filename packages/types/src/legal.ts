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
    // 2026-08-04: rewrote §2 (three sign-in paths, guest participation, the
    // acceptance record), marked Google OAuth as not yet enabled, added §4bis
    // on organiser obligations, and replaced §12's "continued use is
    // acceptance" with what the product actually does — it asks.
    version: '2026-08-04',
    path: { en: '/en/terms', fr: '/terms' },
  },
  privacy: {
    kind: 'privacy',
    // 2026-08-11: corrected §7 and §8. The 2026-08-04 rewrite fixed the
    // template's "Sentry self-hosted" claim by calling Sentry a US transfer,
    // and overshot — the DSN points at Sentry's European region, so the logs
    // are stored in Germany and were never a transfer out of the EU at all.
    // §8 now lists two flows, not three. Separately, the marketing site stopped
    // loading Google Fonts, which was an undisclosed fourth flow reaching
    // Google from every page including this one; §8's undertaking to name them
    // all is true as written for the first time.
    //
    // Bumped rather than corrected in place: legal_acceptances is append-only
    // and exists to answer "what exactly did this user agree to", which two
    // different texts sharing version 2026-08-04 would destroy. The change
    // narrows what we claim leaves the EU, so it expands no processing.
    //
    // 2026-08-04: full rewrite. The previous text was a template that
    // described a different product and stated four things that were false of
    // this one — Sentry self-hosted, no transfers outside the EU, analytics
    // cookies behind a consent panel that did not exist, and a 30-day
    // deletion grace period. See docs/decisions/ADR-012-cookie-consent.md.
    version: '2026-08-11',
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
