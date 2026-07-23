import { cookies, headers } from 'next/headers';
import {
  createTranslator,
  getMessages,
  LOCALE_COOKIE,
  negotiateLocale,
  type Locale,
  type TranslationValues,
} from '@myclash/i18n';

/**
 * Resolve the visitor's locale server-side: an explicit `mc_locale` cookie
 * wins (set by the language switcher), else the browser's Accept-Language,
 * else `defaultLocale`. Reading the request opts the caller into dynamic
 * rendering — intended, since the rendered output is locale-specific.
 */
export async function resolveServerLocale(): Promise<Locale> {
  try {
    const cookie = (await cookies()).get(LOCALE_COOKIE)?.value ?? null;
    const acceptLanguage = (await headers()).get('accept-language');
    return negotiateLocale({ cookie, acceptLanguage });
  } catch {
    // No request scope (e.g. the stats-render perf harness renders the page
    // directly) — Next 16 throws on cookies()/headers() there. Locale is a
    // non-critical enhancement, so fall back to default rather than crash.
    return negotiateLocale({ cookie: null, acceptLanguage: null });
  }
}

/**
 * A request-scoped translator bound to the resolved locale. Use in server
 * components and `generateMetadata` in place of the module-level `t` (which is
 * permanently bound to `defaultLocale` and always renders English).
 */
export async function getServerT(): Promise<(key: string, values?: TranslationValues) => string> {
  return createTranslator(getMessages(await resolveServerLocale()));
}
