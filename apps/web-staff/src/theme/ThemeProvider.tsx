'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  chromeScopeFor,
  defaultScoringTheme,
  padScopeFor,
  type ScoringTheme,
  type ThemeScope,
} from './theme';

interface ThemeContextValue {
  mode: ScoringTheme;
  /** `data-theme` for the scoring pad — matches what the root layout put on <body>. */
  padScope: ThemeScope;
  /** `data-theme` for chrome regions: header, corrections drawer, lice lists. */
  chromeScope: ThemeScope;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: defaultScoringTheme,
  padScope: padScopeFor(defaultScoringTheme),
  chromeScope: chromeScopeFor(defaultScoringTheme),
});

/**
 * Publishes the server-resolved theme to the client tree.
 *
 * Two kinds of consumer need it, and only one of them is CSS:
 *   1. Chrome regions, which set `data-theme={chromeScope}` on their root.
 *   2. Components whose colours are picked in JS and therefore cannot follow a
 *      CSS scope at all — `statusPillTone` (raw palette classes, chosen by a
 *      `surface` argument) and `BoutFlowChart`'s `surface` prop.
 *
 * Seeded from the server so the first client render already agrees with the
 * server-rendered <body data-theme>.
 */
export function ThemeProvider({ children, mode }: { children: ReactNode; mode: ScoringTheme }) {
  const value = useMemo(
    () => ({
      mode,
      padScope: padScopeFor(mode),
      chromeScope: chromeScopeFor(mode),
    }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useScoringTheme() {
  return useContext(ThemeContext);
}
