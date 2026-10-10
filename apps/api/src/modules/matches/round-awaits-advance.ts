import { BadRequestException } from '@nestjs/common';

/** The code of the refusal below. The pad says it in the reader's language. */
export const ROUND_AWAITS_ADVANCE = 'round_awaits_advance';

/**
 * The refusal of a clock Start or Resume between two rounds of a best-of bout
 * (operator, 2026-10-09). The round is closed and the next one is not open:
 * a clock that runs there times nobody. A 400 with its own code, like
 * `matchLocked()`.
 */
export const roundAwaitsAdvance = () =>
  new BadRequestException({
    message: 'Round ended — start the next round before the clock',
    code: ROUND_AWAITS_ADVANCE,
  });

/**
 * The refusal of a new hit or card between two rounds: it would be stamped with
 * a round whose result is already banked. The same code, so a pad that sends
 * one from its queue holds it and says why in its own words.
 */
export const scoringAwaitsRoundAdvance = () =>
  new BadRequestException({
    message: 'Round ended — advance to the next round before scoring',
    code: ROUND_AWAITS_ADVANCE,
  });
