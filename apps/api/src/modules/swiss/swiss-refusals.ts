import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** The code of a put-back refused while the fighter is out of the Tournament (0244). */
export const FIGHTER_OUT = 'fighter_out';
/** The code of a delete refused while a black card or a forfeit sits on the round's bouts. */
export const ROUND_HAS_RECORDS = 'round_has_records';

/** The refusals of `swiss_delete_last_round` (0244), as today's sentences. */
export function deleteRefusal(
  error: { code?: string; message: string },
  roundNumber: number,
): Error {
  if (error.code === 'P0002') return new NotFoundException('This phase has no rounds');
  const last = /^not_last_round: (\d+)/u.exec(error.message)?.[1];
  if (error.code === 'P0001' && last) {
    return new ConflictException(
      `Only the last round (${last}) can be deleted; rounds are cumulative.`,
    );
  }
  if (error.code === 'P0001' && error.message.startsWith('round_under_way')) {
    return new ConflictException(`Round ${roundNumber} has a bout under way`);
  }
  if (error.code === 'P0001' && error.message.startsWith(ROUND_HAS_RECORDS)) {
    return new ConflictException({
      message: `Round ${roundNumber} holds a black card or a forfeit: take it back first`,
      code: ROUND_HAS_RECORDS,
    });
  }
  return new BadRequestException(error.message);
}
