import { TeamChip } from '@myclash/ui';
import type { BoardMatch } from './types';

/**
 * A piste's bout in one line: each side's name, with a team's chip before it, and the score
 * between. The live board row, its phone card and the wall are tight surfaces: a name and its
 * chip, no logo (call 6). A Fighter's side has no colour, so it shows no chip and no space.
 *
 * `dark` is the wall's: the projector stage is near-black, and a black team's chip needs the
 * stage's edge to show.
 */
export function BoardBoutLine({ match, dark = false }: { match: BoardMatch; dark?: boolean }) {
  return (
    <>
      <TeamChip colour={match.redColour} dark={dark} />
      {`${match.redFighterName ?? '—'} ${match.redScore}–${match.blueScore} `}
      <TeamChip colour={match.blueColour} dark={dark} />
      {match.blueFighterName ?? '—'}
    </>
  );
}
