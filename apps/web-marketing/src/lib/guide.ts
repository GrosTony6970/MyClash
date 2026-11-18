import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from '../i18n/ui';

export type GuideEntry = CollectionEntry<'guide'>;

/** `fr/pools` → `pools`; `fr/index` → undefined, which Astro builds as the bare `/guide`. */
function slugOf(entry: GuideEntry): string | undefined {
  const slug = entry.id.slice(entry.id.indexOf('/') + 1);
  return slug === 'index' ? undefined : slug;
}

/** The locale-independent route of a guide page: `/guide` or `/guide/<slug>`. */
export function guideRoute(entry: GuideEntry): string {
  const slug = slugOf(entry);
  return slug === undefined ? '/guide' : `/guide/${slug}`;
}

/**
 * The static paths of one language's guide. Both route files call this, so the
 * French and English guides cannot be built two different ways.
 */
export async function guideStaticPaths(locale: Locale) {
  const pages = (await getCollection('guide', (entry) => entry.id.startsWith(`${locale}/`))).sort(
    (a, b) => a.data.order - b.data.order,
  );
  return pages.map((entry) => ({ params: { slug: slugOf(entry) }, props: { entry, pages } }));
}
