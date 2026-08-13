import { en } from './messages/en/index.js';
import { fr } from './messages/fr/index.js';

export type { DeepString, Locale, MessageTree } from './message-tree.js';
import type { DeepString, Locale, MessageTree } from './message-tree.js';

/**
 * The dictionary, composed from one module per namespace under src/messages/.
 *
 * It used to be one 16,000-line file. The namespaces already mapped onto the
 * three apps, but a single module meant every app shipped all of them: 181KB
 * gzip of EN+FR in every client bundle, on every page, to read as little as 4%
 * of it on the scoring pad.
 *
 * Importing from HERE still gives you everything, which is correct on the
 * server and in tests. Client code must import a surface instead —
 * `@myclash/i18n/staff`, `/public` or `/admin` — or the split buys nothing.
 *
 * Adding a string: edit `messages/en/<namespace>.ts` and the matching `fr` file.
 * The FR module is typed against the EN one, so a missing key is a tsc error.
 */
export const defaultLocale: Locale = 'en';

export { en, fr };

export const messages = {
  en,
  fr,
} as const;

export type Messages = DeepString<typeof en>;

/** Dot-path union of every leaf key in the `en` message tree (the compile-time key list). */
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/**
 * Strict union of all known translation keys. Use it to type key-bearing values
 * (component props, config fields) so typos are caught at `tsc` —
 * e.g. `labelKey: KnownTranslationKey`.
 */
export type KnownTranslationKey = LeafPaths<typeof en>;

/**
 * Key type accepted by `t()`. Known keys get IDE autocomplete; the `(string & {})`
 * arm preserves dynamically-built keys (template literals) and runtime strings, so
 * existing dynamic call sites keep compiling. Inline-literal typos remain covered by
 * the `t-key-references.test.ts` CI guard.
 */
export type TranslationKey = KnownTranslationKey | (string & {});
export type TranslationValues = Record<string, string | number | boolean | null | undefined>;

export function getMessages(locale: Locale | string = defaultLocale): Messages {
  return messages[locale as Locale] ?? messages[defaultLocale];
}

/** Every locale the UI ships translations for. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'fr'];

/** Name of the cookie that persists an explicit locale choice. */
export const LOCALE_COOKIE = 'mc_locale';

function isSupportedLocale(value: string | null | undefined): value is Locale {
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
  return (key: TranslationKey, values?: TranslationValues): string => {
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

export const t = createTranslator(getMessages(defaultLocale));

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
