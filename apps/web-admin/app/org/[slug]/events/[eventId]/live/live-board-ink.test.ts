import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Live board of an Event, as the organiser reads it during the day (known-deviations D28).
 *
 * - A healthy piste was drawn at 60%, so the piste in trouble would stand out. Most pistes are
 *   healthy most of the day, and at 60% their scorer, "synced" and next bout were 2.3:1. The
 *   state dot, the warning ink and the alert button already mark the piste in trouble, so a
 *   healthy one now keeps full ink.
 * - The open row's panel and two hovers used `bg-surface-2`. theme.css has no such token, so the
 *   class compiled to nothing: the panel had no fill and the hovers did nothing.
 *
 * The board reads live data through hooks, so the sources are read as text.
 */
const FILES = [
  'BoardRowView.tsx',
  'BoardCard.tsx',
  'LiveBoard.tsx',
  'BoardRowDetail.tsx',
  'BoardRowActions.tsx',
];
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('the Live board', () => {
  it.each(FILES)('%s fades no piste', (file) => {
    // A disabled control may still fade: `disabled:opacity-50` is not matched.
    expect(read(file).match(/(?<![\w:-])opacity-60(?![\w-])/g) ?? []).toEqual([]);
  });

  it.each(FILES)('%s names no colour token theme.css lacks', (file) => {
    expect(read(file)).not.toContain('surface-2');
  });

  it("gives the open row's panel a fill and a hairline of its own", () => {
    expect(read('BoardRowDetail.tsx')).toContain('border border-border bg-surface');
  });

  it('shows a hover on the row and on its actions', () => {
    expect(read('BoardRowView.tsx')).toContain('hover:bg-foreground/5');
    expect(read('BoardRowActions.tsx')).toContain('hover:bg-foreground/5');
  });
});
