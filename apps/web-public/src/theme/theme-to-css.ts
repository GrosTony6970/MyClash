/**
 * theme-to-css.ts — Convert EventTheme to inline CSS variable string.
 *
 * Injected as a <style> tag in the event layout.
 * Overrides the default tokens.css values for this event's subtree.
 */

import type { EventTheme } from './types';

/** Hex color -> slightly darkened version for hover states. */
function darken(hex: string, amount = 20): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function themeToCss(theme: EventTheme): string {
  const lines: string[] = [
    ':root {',
    `  --color-primary: ${theme.primaryColor};`,
    `  --color-primary-hover: ${darken(theme.primaryColor)};`,
    `  --color-secondary: ${theme.secondaryColor};`,
    `  --color-secondary-hover: ${darken(theme.secondaryColor)};`,
    `  --color-accent: ${theme.accentColor};`,
    `  --font-display: '${theme.fontDisplay}', 'Georgia', serif;`,
    `  --font-body: '${theme.fontBody}', 'system-ui', sans-serif;`,
    '}',
  ];

  if (theme.customCss) {
    // Sanitize: strip <script> tags and javascript: URLs
    const safe = theme.customCss
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/javascript:/gi, '');
    lines.push(safe);
  }

  return lines.join('\n');
}
