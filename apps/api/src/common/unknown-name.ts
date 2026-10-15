import { createTranslator, messages } from '@myclash/i18n';

/**
 * The English words for a person with no name, for what the API writes in English itself: the
 * archive's CSV files and the AI assistant's tables. Never their id (operator ruling, X2). A
 * screen words a blank name in its reader's language with `nameOrUnknown` of packages/ui; a read
 * the pages word sends the name blank. The words are the same keys, so the two cannot drift.
 */
const english = createTranslator(messages.en);

export function unknownFighterInEnglish(bib?: number | null): string {
  return bib == null
    ? english('common.unknownName.fighter')
    : english('common.unknownName.fighterWithBib', { bib });
}

export function unknownRefereeInEnglish(): string {
  return english('common.unknownName.referee');
}
