import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every page under app/admin renders inside SuperAdminShell, whose
 * `<div id="main-content" className="flex-1">` carries ZERO padding by design:
 * the shell owns the sidebar and the header, each page owns its own gutters. A
 * shell that padded would fight every full-bleed grid inside it. A page that
 * forgets sits flush against the dark sidebar, and the `border-b` that
 * AdminPageHeader always draws runs from edge to edge.
 *
 * /admin/data-retention shipped exactly that — `<div className="flex flex-col
 * gap-6">`: no mx-auto, no max-w, no px, and no <main> landmark either. It was
 * the only one of 42 pages that did. A scan rather than a per-page assertion
 * because the failure is invisible in review (nothing throws, the page merely
 * looks broken) and because the page at risk is the next one somebody adds.
 *
 * Scope is app/admin only, deliberately:
 *   - app/org pages mostly delegate their whole body to a view component, so
 *     the gutter lives a file away and this scan would be mostly exemptions;
 *   - app/org/[slug]/events/[eventId]/schedule/page.tsx is a deliberate
 *     full-bleed `<main>` with no className at all — the timeline grid runs to
 *     the viewport edge — so gating that tree would red a correct page;
 *   - app/leagues has the same shape as app/org.
 * Widen ADMIN_ROOT only if those trees ever adopt the app/admin idiom.
 */

const APP_ROOT = join(__dirname, '..', '..');
const ADMIN_ROOT = join(APP_ROOT, 'app', 'admin');

/**
 * Pages that render no DOM at all: `redirect()` throws before the component
 * returns. Listed explicitly rather than sniffed for `redirect(` in the source,
 * because a page that redirects CONDITIONALLY and then renders would exempt
 * itself from the gutter check by accident — a guard reporting green over a
 * live violation is the one failure mode worth spending five lines to avoid.
 * The second test below re-checks that each of these really is still a stub.
 */
const REDIRECT_STUBS = new Set([
  // The league scoring systems moved under /admin/rulesets.
  'app/admin/leagues/scoring-systems/page.tsx',
  'app/admin/leagues/scoring-systems/new/page.tsx',
  'app/admin/leagues/scoring-systems/[id]/edit/page.tsx',
  // /admin/rulesets lands on its scoring sibling.
  'app/admin/rulesets/page.tsx',
]);

/**
 * Pages whose whole body is one component, which carries the gutter instead.
 * The component is scanned IN PLACE OF the page, so this is a redirection of
 * the check rather than a hole in it: move the padding out of the component and
 * this still reds, naming both files.
 */
const DELEGATED_GUTTERS: Record<string, string> = {
  'app/admin/rulesets/league/new/page.tsx':
    'app/admin/rulesets/league/_components/LeagueScoringSystemForm.tsx',
};

/** An unprefixed `px-*` or `p-*`. See hasGutters() for why prefixes are out. */
const GUTTER = /^!?px?-(?!0$)\S+$/;

function pagesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return pagesUnder(full);
    return entry === 'page.tsx' ? [full] : [];
  });
}

const repoPath = (file: string): string => relative(APP_ROOT, file).replace(/\\/g, '/');

/**
 * The attribute text of every `<main …>` opening tag in `source`.
 *
 * Scanned character by character instead of `/<main[^>]*>/` for two reasons: a
 * Tailwind arbitrary value may legitimately contain `>` (`[&>*]:mt-4`), which
 * would truncate the class list, and a wrapped `<main\n  className="…"\n>` is
 * just whitespace to a scanner. Quotes and braces are tracked so a `>` inside
 * either does not end the tag early.
 */
function mainTagAttributes(source: string): string[] {
  const opener = /<main[\s/>]/g;
  const tags: string[] = [];
  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    const from = match.index + '<main'.length;
    let quote = '';
    let depth = 0;
    for (let i = from; i < source.length; i++) {
      const ch = source[i] ?? '';
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      } else if (ch === '>' && depth === 0) {
        tags.push(source.slice(from, i));
        break;
      }
    }
  }
  return tags;
}

/** The `{…}` expression at the head of `value`, brace-balanced, braces dropped. */
function braced(value: string): string {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '{') {
      depth += 1;
    } else if (value[i] === '}') {
      depth -= 1;
      if (depth === 0) return value.slice(1, i);
    }
  }
  return value;
}

/** The class list of one tag, or '' when it carries no className at all. */
function classListOf(attributes: string): string {
  const at = attributes.indexOf('className');
  if (at === -1) return '';
  const value = attributes.slice(at + 'className'.length).replace(/^\s*=\s*/, '');
  // className={cn('p-8', dense && 'p-4')} — every string literal inside the
  // expression counts, since any one of them may be the branch that pads.
  if (value.startsWith('{')) {
    return [...braced(value).matchAll(/(['"`])([^'"`]*)\1/g)].map((m) => m[2] ?? '').join(' ');
  }
  return value.match(/^(['"`])([^'"`]*)\1/)?.[2] ?? '';
}

/**
 * Gutters mean an UNPREFIXED `px-*` or `p-*`.
 *
 * `pl-*` alone is half a gutter. A variant-only `sm:px-6` leaves the page flush
 * on a phone, which is where the sidebar collapses and the content meets the
 * viewport edge. `px-0` is the original bug wearing a hat. All twenty padding
 * idioms already in app/admin carry a base `px-*` or `p-*` — from the terse
 * `p-8` to `mx-auto max-w-[110rem] px-4 py-6 sm:px-6 lg:px-8` — so this accepts
 * every one of them and still refuses the three shapes above.
 */
function hasGutters(classList: string): boolean {
  return classList.split(/\s+/).some((token) => GUTTER.test(token));
}

/** null when the file is fine; otherwise why it is not. */
function gutterProblem(file: string): string | null {
  const tags = mainTagAttributes(readFileSync(file, 'utf8'));
  if (tags.length === 0) return 'renders no <main> at all';
  const bare = tags.map(classListOf).find((classList) => !hasGutters(classList));
  return bare === undefined ? null : `<main className="${bare}"> has no horizontal padding`;
}

describe('every admin page owns its own gutters', () => {
  it('opens a <main> carrying horizontal padding', () => {
    const offenders = pagesUnder(ADMIN_ROOT)
      .map(repoPath)
      .filter((page) => !REDIRECT_STUBS.has(page))
      .flatMap((page) => {
        const carrier = DELEGATED_GUTTERS[page] ?? page;
        const problem = gutterProblem(join(APP_ROOT, carrier));
        if (!problem) return [];
        return [`${page}${carrier === page ? '' : ` → ${carrier}`}: ${problem}`];
      });

    expect(
      offenders,
      'these render inside SuperAdminShell, whose <div id="main-content" className="flex-1"> ' +
        "adds NO padding — on the admin every gutter is the page's own. Without one the content " +
        "sits flush against the dark sidebar and AdminPageHeader's border-b runs edge to edge, " +
        'which is what /admin/data-retention shipped. Wrap the page in ' +
        '<main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8"> — the house idiom, shared by ' +
        'audit-log, backups, review-queue and system-versions. If the page really is a redirect ' +
        'stub, or really does delegate its whole body to one component, add it to REDIRECT_STUBS ' +
        'or DELEGATED_GUTTERS above WITH THE REASON, so the exemption survives review.',
    ).toEqual([]);
  });

  it('keeps every exemption honest', () => {
    for (const stub of REDIRECT_STUBS) {
      expect(
        readFileSync(join(APP_ROOT, stub), 'utf8'),
        `${stub} is exempt because it only calls redirect(). It no longer does — either give it ` +
          'a padded <main> or drop it from REDIRECT_STUBS.',
      ).toContain('redirect(');
    }

    for (const [page, carrier] of Object.entries(DELEGATED_GUTTERS)) {
      expect(
        readFileSync(join(APP_ROOT, page), 'utf8'),
        `${page} is exempt because ${carrier} owns its <main>. It now declares one itself, so the ` +
          'exemption is stale — drop it from DELEGATED_GUTTERS and let the page be scanned.',
      ).not.toContain('<main');
    }
  });

  it('actually reaches the admin pages', () => {
    expect(
      pagesUnder(ADMIN_ROOT).length,
      'a scan that finds nothing passes everything. app/admin held 42 page.tsx files when this ' +
        'guard was written; reading near zero means the walker broke, not that the pages did.',
    ).toBeGreaterThan(30);
  });
});
