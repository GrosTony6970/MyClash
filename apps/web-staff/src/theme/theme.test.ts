import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chromeScopeFor,
  defaultScoringTheme,
  nextScoringTheme,
  padScopeFor,
  parseScoringTheme,
  SCORING_THEMES,
  type ScoringTheme,
  type ThemeScope,
} from './theme';

describe('parseScoringTheme', () => {
  it.each(SCORING_THEMES)('accepts %s', (mode) => {
    expect(parseScoringTheme(mode)).toBe(mode);
  });

  // A stale or hand-edited cookie must not brick the app into an undefined
  // scope — every unknown value lands on the default.
  it.each([null, undefined, '', 'DARK', 'system', 'auto'])('falls back for %s', (raw) => {
    expect(parseScoringTheme(raw)).toBe(defaultScoringTheme);
  });
});

describe('scope derivation', () => {
  // The whole model, as a table. `hybrid` is the load-bearing row: it must keep
  // reproducing the pre-switcher rendering (dark pad, light chrome) exactly, or
  // every tablet in the fleet changes appearance on deploy.
  const CASES: ReadonlyArray<[ScoringTheme, ThemeScope, ThemeScope]> = [
    ['hybrid', 'dark', 'light'],
    ['dark', 'dark', 'dark'],
    ['light', 'light', 'light'],
  ];

  it.each(CASES)('%s → pad %s, chrome %s', (mode, pad, chrome) => {
    expect(padScopeFor(mode)).toBe(pad);
    expect(chromeScopeFor(mode)).toBe(chrome);
  });

  it('defaults to the hybrid the app shipped with', () => {
    expect(defaultScoringTheme).toBe('hybrid');
    expect(padScopeFor(defaultScoringTheme)).toBe('dark');
    expect(chromeScopeFor(defaultScoringTheme)).toBe('light');
  });

  // Only 'dark' and 'light' scopes exist in theme.css, and [data-theme='light']
  // is checked against [data-theme='dark'] by theme-scope-parity.test.ts. A
  // third scope name would resolve to nothing and inherit silently.
  it('never emits a scope theme.css does not define', () => {
    for (const mode of SCORING_THEMES) {
      expect(['dark', 'light']).toContain(padScopeFor(mode));
      expect(['dark', 'light']).toContain(chromeScopeFor(mode));
    }
  });
});

// Quick win P12 (operator, 2026-10-12): one 44px button that goes round the
// three themes, where three symbols of 16px stood.
describe('the theme button', () => {
  it.each([
    ['hybrid', 'dark'],
    ['dark', 'light'],
    ['light', 'hybrid'],
  ] as const)('goes from %s to %s', (mode, next) => {
    expect(nextScoringTheme(mode)).toBe(next);
  });

  it('reaches every theme in one round', () => {
    const seen = new Set<ScoringTheme>();
    let mode: ScoringTheme = defaultScoringTheme;
    for (const _ of SCORING_THEMES) {
      mode = nextScoringTheme(mode);
      seen.add(mode);
    }
    expect([...seen].sort()).toEqual([...SCORING_THEMES].sort());
  });

  it('is one touch target that says the theme it shows and the one it goes to', () => {
    const switcher = readFileSync(join(__dirname, 'ThemeSwitcher.tsx'), 'utf8');
    expect(switcher.match(/<button/g)).toHaveLength(1);
    expect(switcher).toContain('const next = nextScoringTheme(mode);');
    expect(switcher).toContain('persistTheme(next);');
    expect(switcher).toContain("aria-label={t('scoring.theme.change', {");
    expect(switcher).toContain('className={`inline-flex min-h-[44px] min-w-[44px] ');
    expect(switcher).toContain('{t(LABEL_KEY[mode])}');
  });
});

describe('the controls of the bout header', () => {
  const header = readFileSync(join(__dirname, '..', 'components', 'MatchHeader.tsx'), 'utf8');

  // The pad's touch target: never under 44px (docs/design/web-staff.md).
  it('are 44px: Back, Match actions, External display', () => {
    expect(header).toMatch(/const backClassName =\s+'inline-flex min-h-\[44px\] items-center /);
    expect(header).toMatch(
      /data-testid="open-corrections"\s+onClick=\{onOpenCorrections\}\s+className="mt-1 inline-flex min-h-\[44px\] /,
    );
    expect(header).toMatch(
      /onClick=\{\(\) => openScoreboardPopup\(displayUrl\)\}\s+className="inline-flex min-h-\[44px\] /,
    );
  });
});
