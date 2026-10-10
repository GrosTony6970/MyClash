import { describe, expect, it } from 'vitest';
import { noExchangeRewrite } from './no-exchange-rewrite';

/**
 * "Edit as no exchange" sent three fields the route does not take (an id, a
 * sequence and a time, as a new hit has). The server refuses a body with a
 * field it does not know, so every rewrite was a 400. The browser test of the
 * button has a stubbed server and did not see it.
 */
describe('the body of "Edit as no exchange"', () => {
  it('names the new type, its reason and the referee’s reason, and nothing else', () => {
    expect(noExchangeRewrite('wrong fighter')).toEqual({
      type: 'no_exchange',
      noExchangeReason: 'other',
      reason: 'wrong fighter',
    });
  });
});
