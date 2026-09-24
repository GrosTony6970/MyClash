import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every display route keeps its login alive (operator rulings 92, 94): a hall
 * screen signed in as a club member shows the bouts the public cannot see, and
 * its one-hour token must be renewed before the API reads it as a stranger.
 *
 * This package's vitest does not compile TSX, so the layouts are read as text:
 * every `display/page.tsx` must sit beside a `layout.tsx` that imports and
 * renders `<LoginKeepAlive />`. A new display route without one goes red.
 */
const APP = __dirname;

function displayPages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return displayPages(path);
    return entry.name === 'page.tsx' && dirname(path).endsWith('display') ? [path] : [];
  });
}

/** The route folder of a page, with forward slashes on every platform. */
const route = (page: string) => relative(APP, dirname(page)).split('\\').join('/');

describe('display routes', () => {
  const pages = displayPages(APP);

  it('finds the three display routes, so an empty scan cannot pass', () => {
    expect(pages.map(route).sort()).toEqual([
      'e/[eventSlug]/display',
      'e/[eventSlug]/lice/[liceName]/display',
      'e/[eventSlug]/match/[matchId]/display',
    ]);
  });

  it.each(displayPages(APP).map((page) => [route(page), dirname(page)]))(
    '%s keeps the login alive around the page',
    (_, dir) => {
      const layout = join(dir, 'layout.tsx');
      expect(existsSync(layout)).toBe(true);
      const source = readFileSync(layout, 'utf8');
      expect(source).toMatch(
        /import \{ LoginKeepAlive \} from '[./]+\/src\/components\/LoginKeepAlive';/,
      );
      expect(source).toContain('{children}');
      expect(source).toContain('<LoginKeepAlive />');
    },
  );
});
