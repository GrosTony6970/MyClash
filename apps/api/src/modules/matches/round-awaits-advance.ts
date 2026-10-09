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
