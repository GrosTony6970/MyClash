import type { components } from '@myclash/api-client';

/**
 * The body of "Edit as no exchange": the corrections drawer rewrites one
 * entry as "no exchange".
 *
 * Typed by the route's own schema. The route refuses a field it does not know,
 * and the pad sent the id, the sequence and the time of a new hit beside
 * these: every rewrite was a 400. A field that is not the route's does not
 * compile here.
 */
export function noExchangeRewrite(reason: string): components['schemas']['EditExchangeDto'] {
  return { type: 'no_exchange', noExchangeReason: 'other', reason };
}
