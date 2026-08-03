import { cookies } from 'next/headers';
import { parseScoringTheme, THEME_COOKIE, type ScoringTheme } from './theme';

/**
 * Resolve the operator's colour theme server-side from the `mc_theme` cookie
 * (set by ThemeSwitcher), falling back to `hybrid`.
 *
 * Resolving it on the SERVER is the whole point: the root layout renders
 * `<body data-theme>` already correct, so there is no first-paint flash and no
 * state-in-effect to lint around. Reading the request opts into dynamic
 * rendering — already the case, since the locale is resolved the same way (see
 * ../i18n/server-locale.ts).
 *
 * Deliberately does NOT consult prefers-color-scheme: the operator's tablet
 * fleet must not change appearance on a deploy just because a device is set to
 * light. The cookie is the only input.
 */
export async function resolveServerTheme(): Promise<ScoringTheme> {
  return parseScoringTheme((await cookies()).get(THEME_COOKIE)?.value);
}
