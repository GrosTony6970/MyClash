import type { RequestMagicLinkDto } from './dto/request-magic-link.dto';

/** The three sign-in links the API mails, each for one site. */
export type LinkType = RequestMagicLinkDto['type'];

/**
 * The type the sign-in link's door reads from its address. No mail carries
 * another one than the three: a type edited by hand is read as the door's
 * default, the organizer link. It named a site that has no sign-in page, and
 * it skipped the lockdown, which is asked of an organizer link only.
 */
export function linkTypeOf(asked: string): LinkType {
  return asked === 'public_login' || asked === 'claim' ? asked : 'login';
}
