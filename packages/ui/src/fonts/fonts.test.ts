/**
 * The three typefaces are files of this repo; no build asks a font server.
 *
 * The apps loaded them through the Google loader of next/font, which fetches the files from
 * Google each time an app is built or started. A slow answer failed the build: a red CI job, and
 * on the day of an Event a deploy that cannot run. The files now sit beside this test. The Latin
 * file of each family goes through `next/font/local` in each app's layout; every other subset is
 * declared in `subsets.css`, so a name with a letter outside Latin keeps the typeface of the page.
 *
 * This file holds what the package owns: the files, the subsets and the theme. What the apps'
 * layouts do with them is held by `scripts/fonts-in-repo.test.mjs`, outside this package's build
 * cache.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FONTS = __dirname;
/** The Latin file of each family, with the weights the apps asked Google for. */
const LATIN: Record<string, string> = {
  'fraunces-latin-opsz-normal.woff2': '100 900',
  'geist-latin-wght-normal.woff2': '400 700',
  'jetbrains-mono-latin-wght-normal.woff2': '400 500',
};
/** The unicode-range of every Latin file, as Google Fonts and fontsource declare it. */
const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

const files = readdirSync(FONTS).filter((name) => name.endsWith('.woff2'));
const subsets = readFileSync(join(FONTS, 'subsets.css'), 'utf8');
const theme = readFileSync(join(FONTS, '..', 'theme.css'), 'utf8');

/** A unicode-range as its code points. */
function points(range: string): Set<number> {
  const found = new Set<number>();
  for (const part of range.split(',')) {
    const [low, high = low] = part.trim().slice(2).split('-');
    for (let point = parseInt(low ?? '', 16); point <= parseInt(high ?? '', 16); point++) {
      found.add(point);
    }
  }
  return found;
}

const faces = subsets
  .split('@font-face')
  .slice(1)
  .map((face) => ({
    family: face.match(/font-family: '([^']+)'/)?.[1],
    file: face.match(/url\('\.\/([^']+)'\)/)?.[1],
    weight: face.match(/font-weight: ([^;]+);/)?.[1],
    range: face.match(/unicode-range:\s+([^;]+);/)?.[1],
  }));

describe('the font files', () => {
  it('every file is used: the Latin ones by the layouts, each other one by one face', () => {
    const declared = faces.map((face) => face.file);
    expect([...declared, ...Object.keys(LATIN)].sort()).toEqual([...files].sort());
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('no face holds a character of the Latin file: a Latin page fetches none of them', () => {
    const latin = points(LATIN_RANGE);
    expect(latin.has(0x153)).toBe(true); // œ is Latin, and so is the euro sign
    for (const face of faces) {
      const own = [...points(face.range ?? '')];
      expect(own.length, face.file).toBeGreaterThan(0);
      expect(
        own.filter((point) => latin.has(point)),
        face.file,
      ).toEqual([]);
    }
  });

  it('a face has the weights of the Latin file of its family, so both clamp alike', () => {
    const weightOf = (prefix: string) =>
      Object.entries(LATIN).find(([file]) => file.startsWith(prefix))?.[1];
    for (const face of faces) {
      const prefix = (face.file ?? '').startsWith('jetbrains')
        ? 'jetbrains'
        : face.file?.split('-')[0];
      expect(face.weight, face.file).toBe(weightOf(prefix ?? ''));
    }
  });

  it('each family comes with its licence', () => {
    for (const family of ['fraunces', 'geist', 'jetbrains-mono']) {
      expect(readFileSync(join(FONTS, `OFL-${family}.txt`), 'utf8')).toContain(
        'SIL Open Font License, Version 1.1',
      );
    }
  });
});

describe('the theme', () => {
  it('imports the subsets, and each stack opens with its subset family, then the Latin var()', () => {
    expect(theme).toContain("@import './fonts/subsets.css';");
    expect(theme).toMatch(/--font-display:\s+'Fraunces Subsets', var\(--font-fraunces\),/);
    expect(theme).toMatch(/--font-body:\s+'Geist Subsets', var\(--font-geist\),/);
    expect(theme).toMatch(/--font-mono:\s+'JetBrains Mono Subsets', var\(--font-jetbrains\),/);
    expect(new Set(faces.map((face) => face.family))).toEqual(
      new Set(['Fraunces Subsets', 'Geist Subsets', 'JetBrains Mono Subsets']),
    );
  });
});
