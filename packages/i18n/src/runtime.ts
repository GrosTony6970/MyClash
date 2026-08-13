/**
 * The translation layer's implementation, with none of its data.
 *
 * This split is what makes the per-surface entries work. `index.ts` imports both
 * composed locales at module scope, so **any** import from the package root —
 * even `defaultLocale`, even `LOCALE_COOKIE` — drags all 15 namespaces in both
 * languages into the bundle. @myclash/next-i18n sits in every app's client
 * graph, so one such import there would put the whole 181KB back on every page
 * and quietly undo the split.
 *
 * So: data lives under `messages/`, surfaces compose subsets of it, and
 * everything that operates ON a message tree lives here. Import
 * `@myclash/i18n/runtime` from anything that ships to a browser.
 *
 * `index.ts` re-exports all of it, so the package's public API is unchanged.
 */
import type { Locale, MessageTree } from './message-tree.js';

export type { DeepString, Locale, MessageTree } from './message-tree.js';

export const defaultLocale: Locale = 'en';

/** Every locale the UI ships translations for. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'fr'];

/** Name of the cookie that persists an explicit locale choice. */
export const LOCALE_COOKIE = 'mc_locale';

export type TranslationValues = Record<string, string | number | boolean | null | undefined>;

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Pick the highest-quality Accept-Language entry whose primary subtag is supported. */
function pickFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      const primary = tag.trim().toLowerCase().split('-')[0] ?? '';
      return { primary, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.primary && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { primary } of ranked) {
    if (isSupportedLocale(primary)) return primary;
  }
  return null;
}

/**
 * Resolve the active locale, framework-agnostic so it's unit-testable and
 * reusable from any server runtime. Precedence: an explicit persisted choice
 * (the `mc_locale` cookie) wins; otherwise the browser's Accept-Language hint;
 * otherwise `defaultLocale`. Unsupported/garbage values are ignored, never
 * throwing.
 */
export function negotiateLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  const cookie = input.cookie?.trim().toLowerCase();
  if (isSupportedLocale(cookie)) return cookie;
  return pickFromAcceptLanguage(input.acceptLanguage) ?? defaultLocale;
}

export function createTranslator(source: MessageTree) {
  return (key: string, values?: TranslationValues): string => {
    const template = readMessage(source, key);
    if (template === undefined) {
      return `[${key}]`;
    }

    if (!values) {
      return template;
    }

    return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name: string) => {
      const value = values[name];
      return value === undefined || value === null ? match : String(value);
    });
  };
}

function readMessage(source: MessageTree, key: string): string | undefined {
  let cursor: MessageTree | string | undefined = source;
  for (const part of key.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }

  return typeof cursor === 'string' ? cursor : undefined;
}
