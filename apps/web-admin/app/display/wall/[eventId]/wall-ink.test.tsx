// Explicit React import: this app's vitest transform uses the classic JSX
// runtime, so JSX compiles to React.createElement and needs the binding.
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NOW, agoIso, mkMatch, mkRow } from '@/lib/live-board/live-board.fixtures';
import { WallRow } from './WallRow';

/**
 * The wall sits on the stage, the near-black projector surface, which sets no scope. So the page's
 * own inks resolve to their light-page values there: dark on near-black. Rendered on 2026-11-17,
 * the piste name and the bout line were 1.13:1 and could not be read (known-deviations D14). The
 * wall writes the stage ink instead, and an opacity step of it for the quiet cells.
 *
 * `packages/ui/src/theme-ink-contrast.test.ts` measures those two inks on the stage.
 */

/** A utility that spends a page token: an ink, a hairline or a surface of the light/dark scopes. */
const PAGE_INK =
  /(?<![\w-])(?:text|bg|border)-(?:foreground-secondary|foreground|muted|border|background|surface)(?![\w-])/g;

const t = (key: string) => key;

function classesOf(html: string): string[] {
  return Array.from(html.matchAll(/class="([^"]*)"/g)).flatMap((m) => (m[1] as string).split(' '));
}

describe('the wall row, on the stage', () => {
  const html = renderToStaticMarkup(
    <WallRow row={mkRow()} state="synced" nowMs={NOW} locale="en" t={t} />,
  );
  const classes = classesOf(html);

  it('writes the piste name and the bout line in the stage ink', () => {
    expect(classes.filter((c) => c === 'text-stage-foreground')).toHaveLength(2);
  });

  it('writes the quiet cells in an opacity step of the stage ink', () => {
    expect(classes).toContain('text-stage-foreground/60');
  });

  it('draws the row divider in the stage ink', () => {
    expect(classes).toContain('border-stage-foreground/30');
  });

  it('spends no page ink', () => {
    expect(classes.filter((c) => c.match(PAGE_INK))).toEqual([]);
  });

  // The stage sets no scope, so a bare `text-warning` is the light page's amber on near-black.
  // The "behind" cell takes the dark scope's, 9.37:1 (known-deviations D34).
  it('writes "behind" in the dark scope, so its warning is the bright amber', () => {
    // Ten minutes into a five-minute bout: over time, which is the warning.
    const overTime = mkRow({ currentMatch: mkMatch({ startedAt: agoIso(600) }) });
    const late = renderToStaticMarkup(
      <WallRow row={overTime} state="late" nowMs={NOW} locale="en" t={t} />,
    );
    expect(late).toMatch(/<span data-theme="dark" class="[^"]*text-warning/);
  });
});

describe('the wall sources', () => {
  // LiveWall reads the live board through hooks, so a static render shows its loading line only.
  // Its group label and its messages are read as text.
  it.each(['WallRow.tsx', 'LiveWall.tsx'])('%s names no page ink', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    expect(source.match(PAGE_INK) ?? []).toEqual([]);
  });

  it('LiveWall writes its label and its messages in the quiet stage ink', () => {
    const source = readFileSync(join(__dirname, 'LiveWall.tsx'), 'utf8');
    expect(source.match(/text-stage-foreground\/60/g) ?? []).toHaveLength(2);
  });
});
