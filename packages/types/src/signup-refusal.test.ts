import { describe, expect, it } from 'vitest';
import { LINK_EXPIRED_CODE, LINK_UNCHECKED_CODE, refusedLinkKey } from './signup-refusal';

/**
 * A mailed link that signed nobody in (operator rulings 360, 362). Its door sends the reader
 * to a sign-in page with the reason in the address, and both apps read the sentence here.
 */
describe('the sentence of a mailed link that signed nobody in', () => {
  it('says the link is dead for a code the auth server refused', () => {
    expect(refusedLinkKey(LINK_EXPIRED_CODE)).toBe('auth.login.errors.linkExpired');
    expect(LINK_EXPIRED_CODE).toBe('link_expired');
  });

  it('says to open it again for a code nobody judged', () => {
    expect(refusedLinkKey(LINK_UNCHECKED_CODE)).toBe('auth.login.errors.linkUnchecked');
    expect(LINK_UNCHECKED_CODE).toBe('link_unchecked');
  });

  // A page reads `searchParams`: a missing key, a repeated key, a reason of another door.
  it.each([undefined, '', 'admin_lockdown', ['link_expired'], 'LINK_EXPIRED'])(
    'says nothing for %o',
    (reason) => {
      expect(refusedLinkKey(reason)).toBeNull();
    },
  );
});
