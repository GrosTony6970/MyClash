import { describe, expect, it } from 'vitest';
import {
  chromeScopeFor,
  defaultScoringTheme,
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
