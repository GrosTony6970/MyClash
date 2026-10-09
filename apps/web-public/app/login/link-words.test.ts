import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';
import { linkWordKeys } from './link-words';

/**
 * What the participant sign-in page says to a reader a mailed link's door sent there.
 *
 * Marc clicks the link that confirms his new address (operator ruling 371). The link is the
 * API's own door: it showed him a line of code. It sends him here now, and the page opens on
 * what became of the change. Léa's dead sign-in link (rulings 360, 362) lands here too.
 */
describe('the words of a mailed link, on the participant sign-in page', () => {
  it('says the change is made, as good news', () => {
    expect(linkWordKeys({ emailChange: 'changed' })).toEqual({
      error: null,
      message: 'publicApp.emailChange.confirmed',
    });
  });

  it('says the change was not made, as an error', () => {
    expect(linkWordKeys({ emailChange: 'not_changed' })).toEqual({
      error: 'publicApp.emailChange.notConfirmed',
      message: null,
    });
  });

  it.each([
    ['link_expired', 'auth.login.errors.linkExpired'],
    ['link_unchecked', 'auth.login.errors.linkUnchecked'],
  ])('says a link that is dead or unchecked (%s), as an error', (reason, key) => {
    expect(linkWordKeys({ refused: reason })).toEqual({ error: key, message: null });
  });

  it.each([
    {},
    { emailChange: '' },
    { emailChange: 'toString' },
    { emailChange: ['changed', 'changed'] },
    { refused: 'admin_lockdown' },
    { other: 'changed' },
  ])('says nothing for %j', (query) => {
    expect(linkWordKeys(query)).toEqual({ error: null, message: null });
  });

  it('has the two sentences of the address change in both languages', () => {
    expect(en.publicApp.emailChange.confirmed).toBe(
      'Your email address is changed. Sign in with the new one.',
    );
    expect(fr.publicApp.emailChange.confirmed).toBe(
      'Votre adresse email est modifiée. Connectez-vous avec la nouvelle.',
    );
    expect(en.publicApp.emailChange.notConfirmed).toBe(
      'We could not change your email address. The new address may already have an account.',
    );
    expect(fr.publicApp.emailChange.notConfirmed).toBe(
      "Nous n'avons pas pu modifier votre adresse email. La nouvelle adresse a peut-être déjà un compte.",
    );
  });

  // web-public's vitest compiles no TSX: the screen is read as text.
  it('is what the page opens on: the good news as a notice, the rest as an error', () => {
    const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(page).toContain('const opensOn = useLinkWords(searchParams, t);');
    expect(page).toContain('useState<string | null>(opensOn.message)');
    expect(page).toContain('useState<string | null>(opensOn.error)');
    expect(page).toContain('{message && <AuthNotice tone="success">{message}</AuthNotice>}');
  });
});
