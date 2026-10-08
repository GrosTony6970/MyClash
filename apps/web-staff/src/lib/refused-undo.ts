import type { ApiFailure } from '@myclash/api-client';
import { knownRefusal } from './refusal-copy';

type Translate = Parameters<typeof knownRefusal>[1];

/**
 * What the bout screen says when the server refused an undo the tablet had
 * written down (ruling 354): that it was refused and the entry is on the list
 * again, then the reason when the pad has its own words for it. Never the
 * API's English sentence: the referee reads this later, in his language.
 */
export function refusedUndoWords(refusal: ApiFailure, t: Translate): string {
  const said = t('scoring.corrections.earlierUndoRefused');
  const why = knownRefusal(refusal, t);
  return why ? `${said} ${why}` : said;
}
