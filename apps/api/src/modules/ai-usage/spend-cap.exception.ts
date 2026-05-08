import { HttpException, HttpStatus } from '@nestjs/common';

export class SpendCapExceededException extends HttpException {
  constructor(eventId: string, capEur: number, spentEur: number) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Spend cap exceeded',
        message: `Event ${eventId} has reached its AI spend cap of €${capEur.toFixed(2)} (current: €${spentEur.toFixed(2)})`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
