import {
  EMAIL_CHANGE_PARAM,
  EMAIL_CHANGED_CODE,
  EMAIL_NOT_CHANGED_CODE,
  EMAIL_TAKEN_ON_ROSTER_CODE,
  LINK_EXPIRED_CODE,
  LINK_UNCHECKED_CODE,
  SIGNUP_REFUSED_PARAM,
} from '@myclash/types';

/**
 * What became of an email-change link. `changed`: the account has the new
 * address. `refused`: the auth server judged the change and said no. `taken`:
 * a roster the account is on has the address on another row. `dead`:
 * the link is made up, cancelled or past its hour. `unchecked`: nobody
 * judged it, and the same link works again.
 */
export type EmailChangeOutcome = 'changed' | 'refused' | 'taken' | 'dead' | 'unchecked';

const REASON: Record<EmailChangeOutcome, string> = {
  changed: `${EMAIL_CHANGE_PARAM}=${EMAIL_CHANGED_CODE}`,
  refused: `${EMAIL_CHANGE_PARAM}=${EMAIL_NOT_CHANGED_CODE}`,
  taken: `${EMAIL_CHANGE_PARAM}=${EMAIL_TAKEN_ON_ROSTER_CODE}`,
  dead: `${SIGNUP_REFUSED_PARAM}=${LINK_EXPIRED_CODE}`,
  unchecked: `${SIGNUP_REFUSED_PARAM}=${LINK_UNCHECKED_CODE}`,
};

/**
 * The page the email-change link's door sends its reader to (operator ruling
 * 371): the participant sign-in page, which says the outcome. A browser that
 * followed a link reads no body, and the link is opened before any session.
 */
export function emailChangePage(domain: string, outcome: EmailChangeOutcome): string {
  return `https://app.${domain}/login?${REASON[outcome]}`;
}
