/**
 * Does the pad ask before it gives this card?
 *
 * Yellow is given at the tap: it is the common card and it costs a warning. Red
 * and black ask first, from the penalty list and from the direct-card panel
 * alike: a scroll that lands as a tap must not disqualify a fighter.
 */

import type { PenaltyCard } from '@myclash/types';

export function cardAsksFirst(card: PenaltyCard | undefined): card is 'red' | 'black' {
  return card === 'red' || card === 'black';
}
