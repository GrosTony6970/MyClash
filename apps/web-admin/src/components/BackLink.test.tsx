import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BackLink } from './BackLink';

/**
 * `BackLink` exists because the admin's back navigation had grown five looks
 * across 24 pages — a muted text link on the platform-accounts editor, a white
 * button on the staff page, a bordered pill on the league ranking. These tests
 * hold the shape AND the reach: the first proves the affordance renders as a
 * button, the rest prove no page has quietly hand-rolled its own again.
 */

const appRoot = join(__dirname, '..', '..');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(join(appRoot, 'app'));
  walk(join(appRoot, 'src'));
  return out;
}

describe('BackLink', () => {
  it('renders a link wearing the design system back button, arrow first and unannounced', () => {
    // Held in a const rather than inlined: `label` is a watched prop, and the
    // i18n lint rightly refuses a literal there even in a test.
    const label = 'Back to platform accounts';
    const html = renderToStaticMarkup(
      <BackLink href="/admin/users" label={label} className="mb-2" />,
    );

    // A link, not a <button> — Button's asChild path paints the styling onto
    // the Next <Link>, so routing and the `link` role both survive.
    expect(html).toContain('<a');
    expect(html).toContain('href="/admin/users"');
    // The `back` variant of @myclash/ui's Button — the one owner of the chrome.
    expect(html).toContain('bg-white');
    expect(html).toContain('border-slate-300');
    // Per-page spacing still lands on the element.
    expect(html).toContain('mb-2');
    // The glyph precedes the label and stays out of the a11y tree: the label
    // already says "back", so an announced arrow would just be noise.
    expect(html).toContain('<span aria-hidden="true">←</span>Back to platform accounts');
  });
});

describe('back-navigation drift guard', () => {
  it('leaves the ← glyph with a single owner', () => {
    const owners = sourceFiles()
      .filter((file) => readFileSync(file, 'utf8').includes('←'))
      .map((file) => relative(appRoot, file).replace(/\\/g, '/'));

    expect(owners).toEqual(['src/components/BackLink.tsx']);
  });

  /**
   * Keys deliberately NOT rendered through `BackLink`. Each is a different idea
   * that merely reads like "back" — adding a key here is a design decision, not
   * a formality, which is the point of making the guard fail on new ones.
   */
  const NOT_BACK_NAVIGATION = new Set([
    // Sibling nav to the Pools tab, not a return path. Keeps its own arrow.
    'organizer.bracketPage.backToPools',
    'organizer.refereesPage.backToPools',
    // The accent CTA of the import-done success state.
    'organizer.personsImport.backToRoster',
    // Breadcrumb crumbs, rendered inside a `Organization / Event` trail.
    'organizer.eventHub.backToOrg',
    'organizer.newEvent.backToOrg',
  ]);

  it('routes every back-navigation label through BackLink', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/t\('([\w.]*\.(?:backTo\w*|backLink))'\)/g)) {
        const key = match[1] ?? '';
        if (NOT_BACK_NAVIGATION.has(key)) continue;
        if (source.includes(`label={t('${key}')}`)) continue;
        offenders.push(`${relative(appRoot, file).replace(/\\/g, '/')} → ${key}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
