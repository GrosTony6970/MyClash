import { describe, expect, it } from 'vitest';
import { buildRobotsRules } from './robots-rules';

const ORIGIN = 'https://app.myclash.fr';

function disallowed(): string[] {
  const [rule] = buildRobotsRules(ORIGIN).rules;
  return rule?.disallow ?? [];
}

describe('buildRobotsRules', () => {
  it('keeps personal space and the auth routes out of the index', () => {
    // Not because they leak -- they need a session -- but because a crawler
    // fetching them indexes the login redirect instead.
    for (const path of ['/me', '/login', '/reset-password', '/notifications']) {
      expect(disallowed()).toContain(path);
    }
  });

  it('keeps the TV display routes out', () => {
    expect(disallowed()).toContain('/display');
  });

  it('does NOT disallow /fighters', () => {
    // The load-bearing case. A Disallow is not a noindex: it stops the crawler
    // FETCHING the profile, so it never reads the per-fighter robots meta tag
    // that decides whether that person opted into indexing. Blanket-disallowing
    // the directory would freeze every profile in whatever state a crawler
    // already had and make opting in impossible.
    for (const entry of disallowed()) {
      expect(entry.startsWith('/fighters')).toBe(false);
    }
  });

  it('does not disallow the public catalogue or any published entity', () => {
    for (const path of ['/', '/e/', '/leagues', '/o/', '/clubs', '/organisers']) {
      expect(disallowed()).not.toContain(path);
    }
  });

  it('points at an absolute sitemap on the configured origin', () => {
    // A relative Sitemap: line is ignored by every major crawler.
    const { sitemap } = buildRobotsRules(ORIGIN);
    expect(sitemap).toBe('https://app.myclash.fr/sitemap.xml');
    expect(() => new URL(sitemap)).not.toThrow();
  });

  it('allows the root so the catalogue is crawlable', () => {
    expect(buildRobotsRules(ORIGIN).rules[0]?.allow).toContain('/');
  });
});
