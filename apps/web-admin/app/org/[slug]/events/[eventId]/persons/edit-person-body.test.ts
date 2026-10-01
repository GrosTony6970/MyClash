import { describe, expect, it } from 'vitest';
import { editPersonBody } from './edit-person-body';

/**
 * Claire opens the roster at 09:00. At 10:00 Léa changes the address of her account, and her
 * roster row follows. At 11:00 Claire fixes Léa's club on the page she still has open: the form
 * holds the address of 09:00. Sent back, it would overwrite Léa's new one, and the row would be
 * taken from her account (ruling 203).
 */
describe('the body of a roster row edit', () => {
  const lea = { email: 'lea@example.com' };
  const form = { givenName: ' Léa ', familyName: 'Martin ', hemaRatingsId: ' 1234 ' };

  it('leaves the address out when Claire did not touch it', () => {
    const body = editPersonBody(lea, { ...form, email: 'lea@example.com' }, 'club-1');
    expect(body).toStrictEqual({
      givenName: 'Léa',
      familyName: 'Martin',
      clubId: 'club-1',
      hemaRatingsId: '1234',
    });
  });

  it('sends the address Claire typed', () => {
    const body = editPersonBody(lea, { ...form, email: ' tom@example.com ' }, 'club-1');
    expect(body).toMatchObject({ email: 'tom@example.com' });
  });

  it('sends "no address" when Claire emptied it', () => {
    expect(editPersonBody(lea, { ...form, email: '  ' }, null)).toStrictEqual({
      givenName: 'Léa',
      familyName: 'Martin',
      email: null,
      clubId: null,
      hemaRatingsId: '1234',
    });
  });

  it('leaves the address out for a row that had none and still has none', () => {
    expect('email' in editPersonBody({ email: null }, { ...form, email: '' }, null)).toBe(false);
  });

  it('sends an empty HEMA Ratings id as none', () => {
    const body = editPersonBody(lea, { ...form, email: 'lea@example.com', hemaRatingsId: '' }, '');
    expect(body).toMatchObject({ clubId: null, hemaRatingsId: null });
  });
});
