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

/**
 * Sanitize organizer-supplied custom CSS before injecting into a <style> tag.
 *
 * Strategy: allowlist approach.
 *   1. Strip ALL HTML tags — valid CSS never contains `<` or `>`.
 *      This eliminates <script>, <img onerror=...>, and any other tag regardless
 *      of case, whitespace, or encoding tricks.
 *   2. Strip dangerous URL schemes: javascript:, data:, vbscript:
 *      (case-insensitive, with optional whitespace/encoding between chars).
 *   3. Strip CSS expressions (IE legacy attack vector).
 *
 * This is defense-in-depth. The primary protection is that Next.js
 * dangerouslySetInnerHTML only injects into a <style> element, not HTML.
 * But we sanitize anyway to prevent CSS injection attacks.
 */
function sanitizeCustomCss(css: string): string {
  return (
    css
      // 1. Strip ALL HTML tags (angle brackets have no place in CSS)
      .replace(/<[^>]*>/g, '')
      // Also strip any remaining lone < or > that could form partial tags
      .replace(/</g, '')
      .replace(/>/g, '')
      // 2. Strip dangerous URL schemes (case-insensitive, allow whitespace between chars)
      .replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '')
      .replace(/d\s*a\s*t\s*a\s*:/gi, '')
      .replace(/v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '')
      // 3. Strip CSS expression() (IE attack vector)
      .replace(/expression\s*\(/gi, '')
  );
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
    lines.push(sanitizeCustomCss(theme.customCss));
  }

  return lines.join('\n');
}
