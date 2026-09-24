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

  // A kiosk that starts after its token ended must reach the browser, where
  // the keep-alive renews the login; `notFound()` would replace the layout.
  it('the bout display lets a renewable login through its 404 gate', () => {
    const page = readFileSync(join(APP, 'e/[eventSlug]/match/[matchId]/display/page.tsx'), 'utf8');
    // The one decision is `displayPageGate`'s (login-cookie.test.ts); the page
    // must act on it alone, with no second 404 or failure of its own.
    expect(page).toContain('const gate = displayPageGate(matchRes.status, jar);');
    expect(page).toContain("if (gate === 'not-found') notFound();");
    expect(page.match(/notFound\(\)/g)).toHaveLength(1);
    expect(page.match(/throw new Error\(/g)).toHaveLength(1);
    expect(page).toContain("if (gate === 'error') throw new Error(");
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
