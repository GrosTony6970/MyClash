import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The pad's quiet states are quiet by colour, not by fade, and its live states pulse a mark, not
 * their words (known-deviations D40, on the rulings of D29 and D35). Measured on 2026-11-17:
 * - a "0" card counter was the card's fill at 30%, 1.2:1 to 2.7:1;
 * - a yellow card's count was white on yellow, 1.92:1;
 * - the clock's centiseconds were 60% and, on the 12px "total time" line, 6px;
 * - the idle clock was the muted ink at 70%, 2.66:1 on the light pad;
 * - the clock's "LIVE" chip pulsed its words, to 2.06:1 at the faint end.
 *
 * This app's tests do not compile JSX, so the sources are read as text.
 */
const read = (file: string) => readFileSync(join(__dirname, 'components', file), 'utf8');

describe('the card counters', () => {
  const source = read('ScoringColumn.tsx');

  it('turn neutral at zero instead of fading', () => {
    expect(source).not.toMatch(/(?<![\w:-])opacity-30(?![\w-])/);
    expect(source).toContain("? 'border border-border text-foreground-secondary'");
  });

  it('write a dark count on the yellow card', () => {
    // raw-color-exempt -- this asserts the card's domain ink, the class the pad itself writes.
    expect(source).toContain("yellow: 'text-slate-900'");
  });
});

describe('the clock', () => {
  const source = read('ScoringCenterControls.tsx');

  it('writes its centiseconds at full ink, never under 10px', () => {
    expect(source).toContain('text-[max(0.5em,10px)] font-bold">');
    expect(source).not.toContain('text-[0.5em]');
  });

  it('writes the idle clock in the full muted ink', () => {
    expect(source).not.toContain('text-muted/70');
  });

  it('shows its state with the shared badge, which pulses a dot and not the words', () => {
    expect(source).toContain('<StatusBadge\n        data-testid="clock-status"');
    expect(source).not.toMatch(/(?<![\w:-])animate-pulse(?![\w-])/);
  });
});
