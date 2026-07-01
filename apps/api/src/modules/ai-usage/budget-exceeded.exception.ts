import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown when a monthly AI budget (org-level or platform-level) is reached.
 * Distinct from SpendCapExceededException (per-event cap) but shares the 402
 * status so clients can treat all budget/cap stops uniformly.
 */
export class BudgetExceededException extends HttpException {
  constructor(
    scope: 'organization' | 'platform' | 'organization-key' | 'platform-key' | 'fighter-key',
    budgetEur: number,
    spentEur: number,
  ) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Budget exceeded',
        message: `The ${scope} monthly AI budget of €${budgetEur.toFixed(2)} has been reached (current: €${spentEur.toFixed(2)})`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
