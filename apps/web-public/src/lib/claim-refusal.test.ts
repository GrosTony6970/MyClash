import { messages } from '@myclash/i18n/public';
import { createTranslator } from '@myclash/i18n/runtime';
import { CLAIM_LINK_REFUSALS } from '@myclash/types';
import { describe, expect, it } from 'vitest';

import { claimRefusalMessageKey } from './claim-refusal';

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

  it.each(['', '?personId=row-1', '?claimRefused=', '?claimRefused=toString'])(
    'says nothing for %j',
    (search) => {
      expect(claimRefusalMessageKey(search)).toBeNull();
    },
  );
});
