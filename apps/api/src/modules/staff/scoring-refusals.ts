import { ForbiddenException } from '@nestjs/common';

/**
 * The refusals of "who may score" that are about the PERSON, not about one
 * bout (rulings 244, 245). Each meets every hit a pad holds, so the pad stops
 * its queue at the first one and says why on its bar: it knows them by their
 * `code`. A refusal about the bout (another piste, another Event) carries no
 * code of its own: the pad holds that one hit and its queue goes on.
 */
export const staffAccountDisabled = () =>
  new ForbiddenException({ message: 'Staff account is disabled', code: 'staff_account_disabled' });

export const staffRoleNotAllowed = () =>
  new ForbiddenException({
    message: 'Staff account role cannot use this surface',
    code: 'staff_role_not_allowed',
  });

/**
 * An account's role check, for a scoring route: "no role in this organisation"
 * is said with its own code. A failed read and a missing login pass through as
 * they are: neither is a verdict about the account.
 */
export async function mayScore(roleCheck: Promise<unknown>): Promise<void> {
  try {
    await roleCheck;
  } catch (error) {
    if (!(error instanceof ForbiddenException)) throw error;
    throw new ForbiddenException({ message: error.message, code: 'account_cannot_score' });
  }
}
