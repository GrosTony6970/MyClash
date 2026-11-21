import { beforeEach, describe, expect, it } from 'vitest';
import { noteOtherTablets, openPisteId, otherTablets, setOpenPiste } from './open-piste';

/**
 * Two tablets on one piste (ruling 953). The check-in sends the piste the pad
 * has open and the server answers how many other tablets it heard from there.
 */
describe('the other tablets on the open piste', () => {
  beforeEach(() => {
    setOpenPiste(null);
    noteOtherTablets(null, 0);
  });

  it('are what the server answered for the piste open now', () => {
    setOpenPiste('lice-a');
    expect(openPisteId()).toBe('lice-a');

    noteOtherTablets('lice-a', 1);

    expect(otherTablets()).toBe(1);
  });

  it('are none when the answer was for the piste the referee has just left', () => {
    setOpenPiste('lice-a');
    // The check-in left from piste A; the referee opened piste B before its answer.
    setOpenPiste('lice-b');
    noteOtherTablets('lice-a', 1);

    expect(otherTablets()).toBe(0);
  });

  it('stay through a move between two bouts of the same piste', () => {
    setOpenPiste('lice-a');
    noteOtherTablets('lice-a', 1);
    // One bout screen closes, the next opens.
    setOpenPiste(null);
    setOpenPiste('lice-a');

    expect(otherTablets()).toBe(1);
  });

  it('are none on no piste', () => {
    noteOtherTablets(null, 3);
    expect(otherTablets()).toBe(0);
  });
});
