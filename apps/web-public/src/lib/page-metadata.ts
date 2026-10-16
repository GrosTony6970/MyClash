import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getServerT } from '@myclash/next-i18n/server';
import { siteTitles } from './page-title';

/**
 * The `generateMetadata` of a page whose tab reads one fixed sentence, in the
 * visitor's language: `export const generateMetadata = titled('publicApp.titles.live');`.
 * The layouts add the Event's name or the site's (`page-title.ts`).
 *
 * A page drawn in the browser cannot export it. It gets a `layout.tsx` beside
 * it that does, and draws its page as it is (`TitleOnlyLayout`).
 */
export function titled(key: string): () => Promise<Metadata> {
  return async () => ({ title: (await getServerT())(key) });
}

/**
 * `titled`, for a layout with pages BELOW its own folder. A plain title in a
 * layout ends the template for every page under it: a person's page read
 * "Participant", not "Participant · FAL 2026". So this one hands the template
 * on: `rule` is the rule of the layout above (`eventTitleRule`, `siteTitleRule`).
 */
export function titledAbove<P>(
  key: string,
  rule: (params: P) => Promise<{ template: string }>,
): (props: { params: Promise<P> }) => Promise<Metadata> {
  return async ({ params }) => ({
    title: { default: (await getServerT())(key), template: (await rule(await params)).template },
  });
}

/**
 * `titledAbove`, for a layout of ONE Event outside the Event's own pages (the personal space,
 * operator ruling 2026-10-16): its page reads "My event · Open de Lyon", not "My event ·
 * MyClash", and the pages below hand the Event on ("My schedule · Open de Lyon"). Two Events in
 * two tabs read apart. `rule` names the Event (`eventTitleRule`: its name, else its address).
 */
export function titledInEvent<P>(
  key: string,
  rule: (params: P) => Promise<{ template: string }>,
): (props: { params: Promise<P> }) => Promise<Metadata> {
  return async ({ params }) => {
    const { template } = await rule(await params);
    return { title: { absolute: template.replace('%s', (await getServerT())(key)), template } };
  };
}

/** The site's rule, for `titledAbove` under a page outside an Event. */
export async function siteTitleRule(): Promise<{ template: string; default: string }> {
  return siteTitles((await getServerT())('metadata.publicTitle'));
}

/** The body of a layout that exists only to give its page a title. */
export function TitleOnlyLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
