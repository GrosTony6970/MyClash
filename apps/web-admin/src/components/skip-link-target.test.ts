import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * `id="main-content"` is the skip link's target — the first thing a keyboard or
 * screen-reader user reaches — so exactly one element per rendered page may
 * carry it. Three shells declare it (`OrganizerAdminShell`, `SuperAdminShell`,
 * `LeagueWorkspaceShell`), and a page rendered inside one must NOT declare its
 * own: two elements share the id, `document.getElementById` returns whichever
 * comes first, and the skip link lands somewhere arbitrary.
 *
 * 23 pages did exactly that. A scan rather than a per-page assertion because
 * the failure is invisible in review — nothing breaks, the page just has an
 * ambiguous landmark — and because the next new page is the one at risk.
 *
 * Routes NOT inside a shell (login, /display) still need their own, so this
 * only polices the trees that a shell wraps:
 *   app/admin/**       → SuperAdminShell        (app/admin/layout.tsx)
 *   app/org/[slug]/**  → OrganizerAdminShell    (app/org/[slug]/layout.tsx)
 *   app/leagues/**     → LeagueWorkspaceShell   (app/leagues/layout.tsx)
 */
const SHELLED_TREES = ['app/admin', 'app/org', 'app/leagues'] as const;

const APP_ROOT = join(__dirname, '..', '..');

function tsxFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFilesUnder(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('the skip link has exactly one target per page', () => {
  it('no page inside a shell declares its own id="main-content"', () => {
    const offenders = SHELLED_TREES.flatMap((tree) =>
      tsxFilesUnder(join(APP_ROOT, tree))
        .filter((file) => readFileSync(file, 'utf8').includes('id="main-content"'))
        .map((file) => relative(APP_ROOT, file).replace(/\\/g, '/')),
    );

    expect(
      offenders,
      'these render inside a shell that already declares id="main-content", so the skip link ' +
        'has two targets and jumps to whichever the DOM happens to hold first. Drop the id — ' +
        'keep the <main> element, it is the landmark that matters.',
    ).toEqual([]);
  });

  it('the shells still declare it, or nothing would be reachable at all', () => {
    const shells = [
      'src/components/OrganizerAdminShell.tsx',
      'src/components/SuperAdminShell.tsx',
      'src/components/LeagueWorkspaceShell.tsx',
    ];
    for (const shell of shells) {
      expect(
        readFileSync(join(APP_ROOT, shell), 'utf8'),
        `${shell} must keep id="main-content" — it is the one element every page inside it has`,
      ).toContain('id="main-content"');
    }
  });
});
