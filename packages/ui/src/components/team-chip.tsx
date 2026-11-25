import * as React from 'react';
import { TournamentColorDot } from './TournamentColorDot';

/**
 * A team side's colour chip, before its name on a row of the bout's history and beside its score
 * in the bout-flow legend (call 6). A Fighter's side has no colour: nothing is drawn, and no space.
 *
 * `dark` gives the chip the stage's ink for its edge: the projector is near-black, and a black
 * team's chip vanished into it (the TV's names do the same). `name` names a chip that stands with
 * no name beside it, as in the legend.
 */
export function TeamChip({
  colour,
  dark = false,
  name,
}: {
  colour: string | null;
  dark?: boolean;
  name?: string;
}): React.ReactElement | null {
  if (!colour) return null;
  return (
    <>
      <span data-theme={dark ? 'dark' : undefined} className="inline-flex">
        <TournamentColorDot color={colour} size="em" title={name} />
      </span>{' '}
    </>
  );
}
