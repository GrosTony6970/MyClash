import type { UndoNotice } from '../offline/db';
import { knownRefusal } from './refusal-copy';

type Translate = Parameters<typeof knownRefusal>[1];

/** One sentence for one undo, another for several: `t()` has no plural. Whole literal keys. */
const WORDS: Record<UndoNotice['why'], [one: string, many: string]> = {
  refused: ['scoring.corrections.earlierUndoRefused', 'scoring.corrections.earlierUndosRefused'],
  expired: ['scoring.corrections.earlierUndoNotSent', 'scoring.corrections.earlierUndosNotSent'],
  ended: ['scoring.corrections.earlierUndoBoutEnded', 'scoring.corrections.earlierUndosBoutEnded'],
};

/**
 * The reason the refused undos share, when the pad has its own words for it.
 * Never the API's English sentence: the referee reads this later, in his
 * language. Two reasons in one notice would name no entry: none is said.
 */
function sharedReason(refused: UndoNotice[], t: Translate): string | null {
  const reasons = new Set(
    refused.map((notice) => (notice.refusal ? knownRefusal(notice.refusal, t) : null)),
  );
  const [only] = reasons;
  return reasons.size === 1 && only ? only : null;
}

/**
 * What the screen of a bout says of the undos the tablet wrote down and did
 * not carry out (rulings 354, 364 to 366): one sentence per cause, with its
 * count. Each says the entries are on the list again.
 */
export function undoNoticeLines(notices: UndoNotice[], t: Translate): string[] {
  return (['refused', 'expired', 'ended'] as const).flatMap((why) => {
    const alike = notices.filter((notice) => notice.why === why);
    if (alike.length === 0) return [];
    const [one, many] = WORDS[why];
    const said = alike.length === 1 ? t(one) : t(many, { count: alike.length });
    const reason = why === 'refused' ? sharedReason(alike, t) : null;
    return [reason ? `${said} ${reason}` : said];
  });
}
