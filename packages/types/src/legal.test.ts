import { describe, expect, it } from 'vitest';
import {
  LEGAL_DOCUMENT_KINDS,
  LEGAL_POLICIES,
  currentLegalVersions,
  isLegalVersionCurrent,
  legalPolicyUrl,
} from './legal';

describe('LEGAL_POLICIES', () => {
  it('covers every kind in LEGAL_DOCUMENT_KINDS', () => {
    // The two must not drift: the acceptance check iterates the array and
    // indexes the record, so a kind in one and not the other is a silent hole.
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      expect(LEGAL_POLICIES[kind]).toBeDefined();
      expect(LEGAL_POLICIES[kind].kind).toBe(kind);
    }
    expect(Object.keys(LEGAL_POLICIES).sort()).toEqual([...LEGAL_DOCUMENT_KINDS].sort());
  });

  it('versions are ISO dates — they are the published "Last updated"', () => {
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      expect(LEGAL_POLICIES[kind].version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('paths are rooted, so joining an origin cannot produce a relative URL', () => {
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      expect(LEGAL_POLICIES[kind].path.en.startsWith('/')).toBe(true);
      expect(LEGAL_POLICIES[kind].path.fr.startsWith('/')).toBe(true);
    }
  });
});

describe('isLegalVersionCurrent', () => {
  it('accepts the published version and rejects anything else', () => {
    expect(isLegalVersionCurrent('terms', LEGAL_POLICIES.terms.version)).toBe(true);
    expect(isLegalVersionCurrent('terms', '1999-01-01')).toBe(false);
    expect(isLegalVersionCurrent('privacy', '')).toBe(false);
  });
});

describe('currentLegalVersions', () => {
  it('mirrors the registry', () => {
    expect(currentLegalVersions()).toEqual({
      terms: LEGAL_POLICIES.terms.version,
      privacy: LEGAL_POLICIES.privacy.version,
    });
  });
});

describe('legalPolicyUrl', () => {
  it('serves French from the root and English from /en', () => {
    expect(legalPolicyUrl('terms', 'fr', 'https://myclash.fr')).toBe('https://myclash.fr/terms');
    expect(legalPolicyUrl('terms', 'en', 'https://myclash.fr')).toBe('https://myclash.fr/en/terms');
  });

  it('falls back to English for an unknown locale', () => {
    expect(legalPolicyUrl('privacy', 'de', 'https://myclash.fr')).toBe(
      'https://myclash.fr/en/privacypolicy',
    );
  });

  it('does not double the slash when the origin carries a trailing one', () => {
    expect(legalPolicyUrl('privacy', 'fr', 'https://myclash.fr/')).toBe(
      'https://myclash.fr/privacypolicy',
    );
  });
});
