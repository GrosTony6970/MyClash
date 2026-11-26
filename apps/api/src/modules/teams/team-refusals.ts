import { BadRequestException, ConflictException } from '@nestjs/common';
import { entrantKindRefusal } from '../../common/entrant-kind-refusal';

/**
 * The refusals of a team write, as the 409 a screen can name. Each carries a stable `reason` a
 * client translates (EN and FR) and an English `message` for a log, in the shape of the
 * Registrations' `tournament_full` and of `entrantKindRefusal`: the error filter puts the body in
 * `details`, with `code: CONFLICT` at the top.
 */

/** 0281's unique index on `(tournament_id, lower(name))`. PostgREST names it only in the text. */
const NAME_KEY = 'teams_tournament_name_key';
/** 0281's unique index on `(tournament_id, slug)`. */
const SLUG_KEY = 'teams_tournament_slug_key';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** The insert lost its slug to a team saved at the same moment. */
export function isSlugTaken(error: NonNullable<DbError>): boolean {
  return error.code === UNIQUE_VIOLATION && Boolean(error.message?.includes(SLUG_KEY));
}

/** The Tournament holds `max_participants` teams already. */
export function tournamentFull(teamCount: number, maxParticipants: number): ConflictException {
  return new ConflictException({
    reason: 'tournament_full',
    message: 'This Tournament has its maximum number of teams.',
    teamCount,
    maxParticipants,
  });
}

/** A bout naming the team has started, so its size is fixed. */
export function teamSizeLocked(): ConflictException {
  return new ConflictException({
    reason: 'team_size_locked',
    message: 'A bout of this team has started, so its size cannot change.',
  });
}

/** A Match or a bracket slot names the team, so it cannot be deleted. */
export function teamInBouts(): ConflictException {
  return new ConflictException({
    reason: 'team_in_bouts',
    message:
      'A bout or the bracket names this team. Remove the team from its Pool and the bracket first.',
  });
}

/**
 * What a refused insert or save of a team answers: the name taken in the Tournament (409
 * `team_name_taken`), the Tournament of the other kind (409, `entrantKindRefusal`), else a 400
 * with the database's text.
 */
export function teamWriteRefusal(error: NonNullable<DbError>): Error {
  if (error.code === UNIQUE_VIOLATION && error.message?.includes(NAME_KEY)) {
    return new ConflictException({
      reason: 'team_name_taken',
      message: 'Another team of this Tournament has this name.',
    });
  }
  return entrantKindRefusal(error) ?? new BadRequestException(error.message);
}

/**
 * What a refused delete answers. The keys of `matches` and `match_forfeits` that name a team are
 * checked at commit (0282), so a bout written after the pre-check refuses the delete with 23503:
 * the same 409 as the pre-check.
 */
export function teamDeleteRefusal(error: NonNullable<DbError>): Error {
  return error.code === FOREIGN_KEY_VIOLATION
    ? teamInBouts()
    : new BadRequestException(error.message);
}
