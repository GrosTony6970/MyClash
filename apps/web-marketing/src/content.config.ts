import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * The organiser guide: one Markdown file per page per language, under
 * src/content/guide/{fr,en}. An entry's id is `<locale>/<slug>`, and
 * `index.md` is the guide's front page. `order` sets the reading order, the
 * contents list and the "Next step" link; the index is 0.
 */
const guide = defineCollection({
  /*
   * The id is the path without `.md`, kept whole. The default id generator
   * shortens `fr/index.md` to `fr`, which drops the index from a `fr/` filter
   * and builds no `/guide` page.
   */
  loader: glob({
    base: './src/content/guide',
    pattern: '**/*.md',
    generateId: ({ entry }) => entry.replace(/\.md$/u, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().int().min(0),
    /** The contents list's group: the walkthrough, the explanations, the event day, the rest, before and after. */
    section: z.enum(['steps', 'concepts', 'day', 'beyond', 'around']),
  }),
});

export const collections = { guide };
