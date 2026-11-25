import { BadRequestException } from '@nestjs/common';
import { sideKey } from '@myclash/types/side-key';
import type { MatchCompletionService } from '../phases/match-completion.service';
import { sidesOf } from './bout-sides';
import { completeMatch, stampResultingState, type BoutDeps } from './fighter-bouts';
import { forfeitEndReason } from './forfeit-end-reason';
import { winnerColumns, type SideColumns } from './winner-columns';

/**
 * The side a forfeit names: a Registration (a Fighter) or a team (ADR-022, call 8). A team
 * forfeits one Match as a whole (call 1): it has no status, so none of the Fighter part runs for
 * it, and it hands its bout on to the completion owner itself (call 13).
 */

type Row = Record<string, unknown>;

export interface ForfeitingSide {
  kind: 'registration' | 'team';
  /** The side's key (`sideKey`): the Registration id or the team id. */
  id: string;
}

/**
 * The side a forfeit names, from exactly one of its two fields. The DTO refuses both and neither;
 * this refuses them again for a caller inside the API (the card path), which builds no DTO.
 */
export function forfeitingSideOf(input: {
  forfeitingRegistrationId?: string;
  forfeitingTeamId?: string;
}): ForfeitingSide {
  const { forfeitingRegistrationId: registrationId, forfeitingTeamId: teamId } = input;
  if (teamId && !registrationId) return { kind: 'team', id: teamId };
  if (registrationId && !teamId) return { kind: 'registration', id: registrationId };
  throw new BadRequestException('A forfeit names exactly one side: a Registration or a team');
}

/**
 * Whether `side` is a side of the bout: by its key (`sidesOf`), and of its kind, so a team id sent
 * as a Registration is refused here rather than by the database.
 */
export function isSideOfBout(match: Row, side: ForfeitingSide): boolean {
  const sides = sidesOf(match);
  const corner = side.id === sides.red ? 'red' : side.id === sides.blue ? 'blue' : null;
  if (corner === null) return false;
  return (match[`${corner}_team_id`] === side.id) === (side.kind === 'team');
}

/** The forfeiting and winning side of a record, each in the column of its kind (0282). */
export function forfeitSideColumns(match: Row, side: ForfeitingSide, winnerSideId: string | null) {
  return {
    forfeiting_registration_id: side.kind === 'registration' ? side.id : null,
    forfeiting_team_id: side.kind === 'team' ? side.id : null,
    ...winnerColumns(match as SideColumns, winnerSideId),
  };
}

/** A live record whose forfeiting side is a team. */
export const isTeamRecord = (record: Row | null): record is Row =>
  typeof record?.['forfeiting_team_id'] === 'string';

/**
 * What a team forfeit stores of the Fighter part (call 1): no inheritance, the team continues in
 * the Tournament, and no outcome on anybody.
 */
export const TEAM_FIGHTER_PART = {
  inheritance: { parentId: null, underOutStatus: false },
  canContinue: true,
  fighterOutcome: null,
} as const;

const BOUT_SIDE_COLUMNS =
  'id, status, red_registration_id, red_team_id, blue_registration_id, blue_team_id';

async function readBout(db: BoutDeps['db'], matchId: string): Promise<Row | null> {
  const { data, error } = await db
    .from('matches')
    .select(BOUT_SIDE_COLUMNS)
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(`Match ${matchId} could not be read: ${error.message}`);
  return (data as Row | null) ?? null;
}

/** Complete a bout still in play from its record: the result the record stored, as it stored it. */
async function completeFromRecord(deps: BoutDeps, bout: Row, record: Row): Promise<void> {
  const forfeitingSideId = sideKey(
    record['forfeiting_registration_id'] as string | null,
    record['forfeiting_team_id'] as string | null,
  );
  const redForfeits = forfeitingSideId === sidesOf(bout).red;
  const own = Number(record['forfeiting_score']);
  const other = Number(record['opponent_score']);
  await completeMatch(deps, bout['id'] as string, {
    winnerSideId: sideKey(
      record['winner_registration_id'] as string | null,
      record['winner_team_id'] as string | null,
    ),
    sides: bout as SideColumns,
    scores: { redScore: redForfeits ? own : other, blueScore: redForfeits ? other : own },
    endReason: forfeitEndReason(record['reason'] as string),
  });
}

/**
 * The one team repair: whatever a send cut short left of a live team record, done now, then the
 * bout handed on. A bout still in play is completed from the record (the insert stood, the
 * completion failed); a completed bout whose record kept no result is stamped (only a completed
 * bout is ever stamped); then the completion owner takes the bout, which is safe twice. A voided
 * bout is left alone. The forfeit door's retries call it, and so does the card door's resend.
 */
export async function repairTeamForfeit(
  deps: BoutDeps,
  completion: Pick<MatchCompletionService, 'onMatchCompleted'>,
  record: Row,
): Promise<void> {
  const matchId = record['match_id'] as string;
  const bout = await readBout(deps.db, matchId);
  if (!bout || bout['status'] === 'voided') return;
  if (bout['status'] !== 'completed') await completeFromRecord(deps, bout, record);
  const kept = (record['resulting_match_state'] as Row | null) ?? {};
  if (Object.keys(kept).length === 0) {
    await stampResultingState(deps.db, record['id'] as string, matchId);
  }
  await completion.onMatchCompleted(matchId);
}
