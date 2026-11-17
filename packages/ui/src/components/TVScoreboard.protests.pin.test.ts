import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The TV scoreboard's protest wiring, read as text: a static render of
 * `TVScoreboard` shows only its loading state (no effects), so the render test
 * cannot reach it. These pins hold the limit's one reader and each column's
 * own registration beside the shared protests.
 */

const source = readFileSync(join(__dirname, 'TVScoreboard.tsx'), 'utf8');

/** One self-closing JSX element, from its opening text to its `/>`. */
function element(opening: string): string {
  const start = source.indexOf(opening);
  expect(start, opening).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('/>', start));
}

describe('TVScoreboard protest wiring', () => {
  it('reads the limit through protestRulesOf, from the raw stored display config', () => {
    expect(source).toContain('protestRulesOf(match.scoringConfig?.display).limit');
  });

  it('gives the red column the red registration beside the protests', () => {
    const red = element('<FighterColumn\n      key="red"');
    expect(red).toContain('registrationId={match.redRegistrationId ?? null}');
    expect(red).toContain('protests={protests}');
    expect(red).toContain('protestLimit={protestLimit}');
  });

  it('gives the blue column the blue registration beside the protests', () => {
    const blue = element('<FighterColumn\n      key="blue"');
    expect(blue).toContain('registrationId={match.blueRegistrationId ?? null}');
    expect(blue).toContain('protests={protests}');
    expect(blue).toContain('protestLimit={protestLimit}');
  });

  it('mounts the chip with the column registration', () => {
    const chip = element('<TvProtestChip');
    expect(chip).toContain('registrationId={registrationId}');
    expect(chip).toContain('protests={protests}');
    expect(chip).toContain('limit={protestLimit}');
  });
});
