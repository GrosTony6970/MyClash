/**
 * The types every message module shares.
 *
 * They live apart from index.ts so a namespace module can be typed without
 * importing the composed dictionary — which is the whole point of the split: a
 * surface entry must reach `messages/en/scoring.ts` without dragging
 * `messages/en/organizer.ts` in behind it.
 */
export type Locale = 'en' | 'fr';

type MessageLeaf = string;

export type MessageTree = {
  readonly [key: string]: MessageLeaf | MessageTree;
};

/**
 * The same tree with every leaf widened to `string`. Each `fr` namespace is
 * declared `satisfies DeepString<typeof enNamespace>`, so a missing or extra key
 * is a tsc error — the guarantee the single-file `satisfies Messages` used to
 * give, kept per namespace instead of over one 16,000-line literal.
 */
export type DeepString<T> = T extends string
  ? string
  : { readonly [K in keyof T]: DeepString<T[K]> };
