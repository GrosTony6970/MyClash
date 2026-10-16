import { BadRequestException } from '@nestjs/common';

/** The code of the refusal below. The pad says it in the reader's language. */
export const RESET_AFTER_LEVEL_STEP = 'reset_after_level_step';

/**
 * "Reset clock" on a bout a level step was taken on (operator, 2026-10-16, "Reset + chain"):
 * refused. The Reset put the clock back to regulation time, and the chain's next step was
 * already sudden death. A Reopen keeps the chain.
 */
export const resetAfterLevelStep = () =>
  new BadRequestException({
    message: 'The clock cannot be reset once extra time or sudden death is under way',
    code: RESET_AFTER_LEVEL_STEP,
  });
