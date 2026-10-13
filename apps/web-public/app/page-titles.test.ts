import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMessages } from '@myclash/i18n';

/**
 * Every page of the public site names its tab (quick wins F15, F16).
 *
 * Eighteen pages had no title at all, and read the site's name or the Event's
 * address; three wrote the site's name themselves and got it twice. A SWEEP, so
 * a new page cannot ship without a title: it has one of its own, or a layout in
 * its own folder gives it, or it stands in the allow-list with its reason.
 *
 * This package's vitest does not compile TSX, so the pages are read as text.
 */
const APP = __dirname;

function filesNamed(dir: string, wanted: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesNamed(path, wanted);
    return wanted.test(name) ? [path.slice(APP.length + 1).replaceAll('\\', '/')] : [];
  });
}

const source = (file: string) => readFileSync(join(APP, file), 'utf8');
const NAMES_ITS_TAB = /export (const|async function) generateMetadata\b|export const metadata\b/;

function layoutBeside(page: string): string | null {
  for (const name of ['layout.tsx', 'layout.ts']) {
    const layout = join(dirname(page), name).replaceAll('\\', '/');
    if (existsSync(join(APP, layout))) return layout;
  }
  return null;
}

function hasTitle(page: string): boolean {
  if (NAMES_ITS_TAB.test(source(page))) return true;
  const layout = layoutBeside(page);
  return layout !== null && NAMES_ITS_TAB.test(source(layout));
}

/** Pages with no title of their own, each with the reason it needs none. */
const NO_TITLE: Record<string, 'redirect' | 'tv'> = {
  // It sends the visitor elsewhere: nobody reads its tab.
  'e/[eventSlug]/lice/[liceName]/page.tsx': 'redirect',
  'me/events/[eventSlug]/overview/page.tsx': 'redirect',
  'me/fighter/page.tsx': 'redirect',
  'me/referee/page.tsx': 'redirect',
  'profile/fighter/page.tsx': 'redirect',
  'profile/referee/page.tsx': 'redirect',
  // A screen on a wall, in fullscreen. Its tab reads the Event's name, from the Event's layout.
  'e/[eventSlug]/lice/[liceName]/display/page.tsx': 'tv',
  'e/[eventSlug]/match/[matchId]/display/page.tsx': 'tv',
};

const pages = filesNamed(APP, /^page\.tsx$/);

describe('every page names its tab', () => {
  it('finds the pages (a sweep that scans nothing proves nothing)', () => {
    expect(pages.length).toBeGreaterThanOrEqual(50);
  });

  it.each(pages.filter((page) => !(page in NO_TITLE)))('%s', (page) => {
    expect(hasTitle(page)).toBe(true);
  });

  it('the allow-list names only pages that exist, have no title, and are what it says', () => {
    for (const [page, reason] of Object.entries(NO_TITLE)) {
      expect(pages, page).toContain(page);
      expect(hasTitle(page), page).toBe(false);
      if (reason === 'redirect') expect(source(page), page).toMatch(/\bredirect\(/);
    }
  });
});

describe('the rule has one owner', () => {
  const titleSources = [...pages, ...filesNamed(APP, /^layout\.tsx?$/)];

  it('the root layout and the Event layout take it from page-title.ts', () => {
    expect(source('layout.tsx')).toContain('title: await siteTitleRule(),');
    expect(source('e/[eventSlug]/layout.tsx')).toContain(
      'return { title: await eventTitleRule(await params) };',
    );
    expect(source('e/[eventSlug]/_lib/event-or-not-found.ts')).toContain(
      "return eventTitles(read.kind === 'found' ? read.event.name : eventSlug);",
    );
  });

  /**
   * A plain title in a layout ends the template for every page below it: a
   * person's page read "Participant", with no Event. A layout with pages below
   * its own folder hands the rule on (`titledAbove`).
   */
  it('a title-only layout with pages below its folder hands the rule on', () => {
    const plain = filesNamed(APP, /^layout\.tsx?$/).filter((file) =>
      /= titled\(/.test(source(file)),
    );
    expect(plain.length).toBeGreaterThanOrEqual(10);
    for (const layout of plain) {
      const folder = dirname(layout).replaceAll('\\', '/');
      const below = pages.filter(
        (page) => page.startsWith(`${folder}/`) && dirname(page).replaceAll('\\', '/') !== folder,
      );
      expect(below, layout).toEqual([]);
    }
  });

  it.each(titleSources)('%s writes no site name and no template of its own', (file) => {
    const text = source(file);
    // The site's name in a title is what doubled it: "Longsword Open · MyClash — MyClash".
    expect(text).not.toMatch(/title[^\n]*MyClash/);
    expect(text).not.toMatch(/[`'"][^`'"\n]*MyClash[`'"]\s*[,}]/);
    expect(text).not.toContain('%s');
  });
});

describe('a title key resolves in English and in French', () => {
  const resolve = (messages: unknown, key: string) =>
    key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);
  const keys = new Set(
    filesNamed(APP, /\.tsx?$/)
      .filter((file) => !file.endsWith('.test.ts'))
      .flatMap((file) =>
        [...source(file).matchAll(/titled(?:Above)?\('([^']+)'/g)].map((m) => m[1]!),
      ),
  );

  it('finds the keys', () => {
    expect(keys.size).toBeGreaterThanOrEqual(25);
  });

  // `titled(key)` is no `t(key)` call: the i18n sweep does not check that its key exists.
  it.each([...keys])('%s', (key) => {
    expect(typeof resolve(getMessages('en'), key), 'en').toBe('string');
    expect(typeof resolve(getMessages('fr'), key), 'fr').toBe('string');
  });
});
