import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { messages } from '@myclash/i18n/public';
import { createTranslator } from '@myclash/i18n/runtime';
import {
  CLAIM_LINK_REFUSALS,
  LINK_EXPIRED_CODE,
  LINK_UNCHECKED_CODE,
  refusedLinkKey,
} from '@myclash/types';
import { describe, expect, it } from 'vitest';

import { claimRefusalMessageKey, claimTapRefusalKey } from './claim-refusal';

// The real translators: `t()` answers a missing key with `[the.key]`, so an
// unresolved string shows up here instead of on the fighter's screen.
const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

describe('claimRefusalMessageKey', () => {
  it.each(CLAIM_LINK_REFUSALS)('gives %s a sentence in English and in French', (reason) => {
    const key = claimRefusalMessageKey(`?personId=row-1&claimRefused=${reason}`);

    expect(key).toEqual(expect.any(String));
    expect(en(key!)).not.toBe(`[${key}]`);
    expect(fr(key!)).not.toBe(`[${key}]`);
  });

  // Each reason asks the fighter for something different, so no two may share
  // a sentence — in either language.
  it('says a different sentence for each reason', () => {
    const keys = CLAIM_LINK_REFUSALS.map((reason) =>
      claimRefusalMessageKey(`?claimRefused=${reason}`),
    );

    expect(new Set(keys.map((key) => en(key!))).size).toBe(CLAIM_LINK_REFUSALS.length);
    expect(new Set(keys.map((key) => fr(key!))).size).toBe(CLAIM_LINK_REFUSALS.length);
  });

  it.each([
    '',
    '?personId=row-1',
    '?claimRefused=',
    '?claimRefused=toString',
    '?refused=',
    '?refused=toString',
    '?refused=held_by_another',
  ])('says nothing for %j', (search) => {
    expect(claimRefusalMessageKey(search)).toBeNull();
  });

  // Ruling 368. Léa clicks her claim mail two days late. The door sends her back to the
  // claim page, and the notice above the form says what a sign-in page says of a dead link.
  it.each([LINK_EXPIRED_CODE, LINK_UNCHECKED_CODE])(
    'gives a claim link that signed nobody in (%s) the sentence of the sign-in pages',
    (reason) => {
      const key = claimRefusalMessageKey(`?personId=row-1&refused=${reason}`);

      expect(key).toBe(refusedLinkKey(reason));
      expect(en(key!)).not.toBe(`[${key}]`);
      expect(fr(key!)).not.toBe(`[${key}]`);
    },
  );

  it('says the claim’s own reason when the address carries both', () => {
    expect(claimRefusalMessageKey('?refused=link_expired&claimRefused=not_found')).toBe(
      claimRefusalMessageKey('?claimRefused=not_found'),
    );
  });
});

/**
 * Ruling 300. Lea taps "this is me" on a row at an Event where her account already holds one.
 * The database refuses, the server counts it, and the page says the emailed link's own sentence.
 */
describe('claimTapRefusalKey', () => {
  it('is the emailed link’s sentence when the database refused a row', () => {
    expect(claimTapRefusalKey({ claimed: 1, alreadyAtEvent: 1 })).toBe(
      claimRefusalMessageKey('?claimRefused=already_at_event'),
    );
  });

  it('says nothing when every row landed', () => {
    expect(claimTapRefusalKey({ claimed: 2, alreadyAtEvent: 0 })).toBeNull();
  });

  it('is asked of the answer by both pages that claim', () => {
    const page = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8');
    const personalSpace = page('app/me/PersonalSpaceDashboard.tsx');
    expect(personalSpace).toContain('if (result.ok) onClaimed(result.data);');
    expect(personalSpace).toContain('setRefusalKey(claimTapRefusalKey(result));');
    // Above the card: a refused row leaves the list, and the card can leave with it.
    expect(personalSpace.indexOf('{t(refusalKey)}')).toBeLessThan(
      personalSpace.indexOf('<ClaimableCard'),
    );
    const profile = page('app/profile/fighter/NoLinkedProfile.tsx');
    expect(profile).toContain('return claimTapRefusalKey(result.data);');
    expect(profile).toContain('{notice ?? error}');
    expect(page('app/profile/fighter/FighterProfileClient.tsx')).not.toContain('claim-persons');
  });
});
