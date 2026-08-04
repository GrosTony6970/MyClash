/**
 * Resolve the marketing-site URLs of the terms and privacy policy.
 *
 * The policy TEXT lives on `web-marketing`, which is served from the apex
 * domain — a different origin from this app, so the links cannot be relative.
 * The version each URL corresponds to comes from `LEGAL_POLICIES`
 * (`@myclash/types`), the one place that says what is currently published.
 *
 * One owner for the same reason `api-url.ts` is one owner: a URL that is
 * assembled inline in each component drifts, and a legal link that 404s is
 * worse than no link at all.
 *
 * Keep the `process.env` access LITERAL — Next only inlines
 * `process.env.NEXT_PUBLIC_FOO` / `process.env['NEXT_PUBLIC_FOO']` into the
 * browser bundle. A dynamic lookup reads `undefined` in production and would
 * silently point every legal link at localhost.
 */
import { LEGAL_POLICIES, legalPolicyUrl, type LegalDocumentKind } from '@myclash/types';

function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/**
 * Origin the marketing site is served from. Missing in production is already a
 * build failure — `NEXT_PUBLIC_MARKETING_URL` is in `REQUIRED_PROD_ENV` in
 * `next.config.ts` — so the fallback only serves local dev.
 */
export function getMarketingUrl(): string {
  return trimmed(process.env['NEXT_PUBLIC_MARKETING_URL']) ?? 'https://myclash.localhost';
}

export function getLegalUrl(kind: LegalDocumentKind, locale: string): string {
  return legalPolicyUrl(kind, locale, getMarketingUrl());
}

/** The versions a signup form must echo back for its acceptance to be recorded. */
export function currentLegalVersionFields(): {
  acceptedTerms: string;
  acceptedPrivacy: string;
} {
  return {
    acceptedTerms: LEGAL_POLICIES.terms.version,
    acceptedPrivacy: LEGAL_POLICIES.privacy.version,
  };
}
