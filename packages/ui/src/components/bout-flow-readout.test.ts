import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The bout chart's score readout writes its numbers in the surrounding ink, each beside a dot in
 * its fighter's colour. The colour was the numbers' ink: 3.45:1 for blue and 3.70:1 for red on
 * the dark pad (known-deviations D41, on the ruling of D38). Read as text: the chart needs a full
 * bout to render.
 */
describe("the bout chart's score readout", () => {
  const source = readFileSync(join(__dirname, 'BoutFlowChart.tsx'), 'utf8');

  it('never writes a number in the side colour', () => {
    expect(source).not.toMatch(/style=\{\{ color: colors\./);
  });

  it('puts a dot in each side colour beside the numbers', () => {
    expect(source).toContain('<SideDot hex={colors.red} />');
    expect(source).toContain('<SideDot hex={colors.blue} />');
  });
});
