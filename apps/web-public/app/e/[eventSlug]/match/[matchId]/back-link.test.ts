import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The bout page's Back link takes its address from `?return=`. Its own older check
 * kept `/\bad-site.test`, which a browser reads as another site. The rule has ONE
 * owner, `isOwnSitePath` of `@myclash/types`, which holds its cases.
 *
 * web-public's vitest does not compile TSX: the page is pinned as text.
 */
const page = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

describe("the public bout page's Back link", () => {
  it('keeps `?return=` only when the one rule takes it', () => {
    expect(page).toContain('const validReturn = isOwnSitePath(returnParam) ? returnParam : null;');
    expect(page).toContain('const backHref = validReturn ?? `/e/${eventSlug}/home`;');
  });

  it('holds no check of its own, and hands the link nothing else', () => {
    expect(page).not.toContain('startsWith(');
    expect(page.match(/returnParam/g)).toHaveLength(3);
  });
});
