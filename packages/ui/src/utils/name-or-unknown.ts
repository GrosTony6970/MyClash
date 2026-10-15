import type { Translator } from '../types/translator';

/** Who the blank name belongs to: it picks the words ("Unknown fighter", "Unknown referee"). */
export type UnknownNameKind = 'fighter' | 'referee' | 'person';

/**
 * The name a screen shows for a person: their name, trimmed, or the words for a
 * person with no name. A fighter's words carry the bib when their Registration has
 * one ("Unknown fighter (bib 12)"). Never an id: an organiser reads the cell aloud.
 * The one owner of that rule; the server sends a blank name, never an id.
 */
export function nameOrUnknown(
  name: string | null | undefined,
  kind: UnknownNameKind,
  t: Translator,
  bib?: number | null,
): string {
  const known = name?.trim();
  if (known) return known;
  if (kind === 'referee') return t('common.unknownName.referee');
  if (kind === 'person') return t('common.unknownName.person');
  return bib == null
    ? t('common.unknownName.fighter')
    : t('common.unknownName.fighterWithBib', { bib });
}
