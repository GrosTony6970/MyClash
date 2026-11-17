import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Quiet by colour, not by fade (known-deviations D29). The organiser's boards set a block or a
 * line back with an opacity and took it under the reading bar:
 *
 * - a completed block on the Blocks view was 60%, its Tournament line 70% of that: 1.9:1 to 2.9:1;
 * - a cancelled Workshop on the Workshops board was 60%, its small lines 70% of that;
 * - the role label of a referee chip was 70% of the chip's ink.
 *
 * A completed block and a cancelled Workshop are now the neutral slate pair at full ink; every
 * line reads at full ink. The legend's focus filter keeps its 30%: the organiser switches it on.
 *
 * The boards need an Event's data to render, so the sources are read as text.
 */
const read = (...path: string[]) => readFileSync(join(__dirname, ...path), 'utf8');
const FADE = /(?<![\w:-])opacity-[4-9]0(?![\w-])/g;

describe('the Blocks view of the schedule', () => {
  const source = read('schedule', 'BlockGridView.tsx');

  it('turns a completed block neutral grey instead of fading it', () => {
    expect(source).toMatch(/allDone\s*\?\s*`\$\{tintBgClassFor\('slate'\)\}/);
    expect(source.match(FADE) ?? []).toEqual([]);
  });

  it("keeps the legend's focus filter", () => {
    expect(source).toContain("dimmed ? 'opacity-30'");
  });
});

describe('the Workshops board', () => {
  const source = read('workshops', 'WorkshopScheduleBoard.tsx');

  it('turns a cancelled Workshop neutral grey instead of fading it', () => {
    expect(source).toMatch(/bl\.cancelled\s*\?\s*`\$\{tintBgClassFor\('slate'\)\}/);
  });

  it('fades no line of a card', () => {
    // `opacity-0` / `group-hover:opacity-100` show the unschedule button on hover: not a fade.
    expect(source.match(FADE) ?? []).toEqual([]);
  });
});

describe('the referee chips', () => {
  it.each([
    ['referees', '_components', 'PoolSlotCard.tsx'],
    ['bracket', '_tabs', 'RefereesTab.tsx'],
    ['live', 'BoardRowDetail.tsx'],
  ])('%s/%s fades no role label', (...path) => {
    expect(read(...path).match(FADE) ?? []).toEqual([]);
  });
});
