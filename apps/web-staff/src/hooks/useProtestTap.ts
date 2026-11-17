'use client';

/**
 * The one tap handler of the protest button, on the pad and on the break
 * screens: `protestTap` (`lib/protest-tap.ts`, where its order and its race are
 * said), with the tap being written held across draws.
 */
import { useRef } from 'react';
import { protestTap, type ProtestTapArgs } from '../lib/protest-tap';

export type { ProtestTapArgs } from '../lib/protest-tap';

/**
 * Answers the tap of one corner: the `clientUuid` of the protest it wrote, or
 * null when it ignored the tap. It rejects when the tablet could not keep the protest.
 */
export function useProtestTap(
  args: ProtestTapArgs,
): (corner: 'red' | 'blue') => Promise<string | null> {
  // The corners being written. The ref is read at the tap, never during the draw.
  const inFlight = useRef(new Set<'red' | 'blue'>());
  return (corner) => protestTap(args, inFlight.current)(corner);
}
