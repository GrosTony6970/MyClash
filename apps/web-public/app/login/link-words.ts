import { use } from 'react';
import {
  EMAIL_CHANGE_PARAM,
  EMAIL_CHANGED_CODE,
  EMAIL_NOT_CHANGED_CODE,
  refusedLinkKey,
  SIGNUP_REFUSED_PARAM,
} from '@myclash/types';

type Query = Record<string, string | string[] | undefined>;
type Words = { error: string | null; message: string | null };

/**
 * The sentence keys of the sign-in page for a reader a mailed link's door sent
 * here, by what the door wrote in the address. A sign-in link that signed
 * nobody in (operator rulings 360, 362), and the link that confirms a new
 * address (ruling 371): changed is good news, the rest is an error.
 */
export function linkWordKeys(query: Query): Words {
  const change = query[EMAIL_CHANGE_PARAM];
  const notChanged =
    change === EMAIL_NOT_CHANGED_CODE ? 'publicApp.emailChange.notConfirmed' : null;
  return {
    error: refusedLinkKey(query[SIGNUP_REFUSED_PARAM]) ?? notChanged,
    message: change === EMAIL_CHANGED_CODE ? 'publicApp.emailChange.confirmed' : null,
  };
}

/**
 * Those sentences, for the page to open on. Read from the page's own
 * `searchParams`, so the server's first paint says them.
 */
export function useLinkWords(query: Promise<Query>, t: (key: string) => string): Words {
  const { error, message } = linkWordKeys(use(query));
  return { error: error && t(error), message: message && t(message) };
}
