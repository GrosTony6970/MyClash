import { describe, expect, it } from 'vitest';
import {
  MAX_SINGLE_ELIM_BRACKET_SIZE,
  singleElimBracket,
  totalBracketMatches,
} from './single-elim';

describe('totalBracketMatches', () => {
  it('always returns N-1 because every match eliminates one fighter', () => {
    expect(totalBracketMatches(2)).toBe(1);
    expect(totalBracketMatches(4)).toBe(3);
    expect(totalBracketMatches(8)).toBe(7);
    expect(totalBracketMatches(16)).toBe(15);
    expect(totalBracketMatches(13)).toBe(12);
  });
});

describe('singleElimBracket', () => {
  it('16 fighters keep the standard four-round bracket with no play-ins', () => {
    const bracket = singleElimBracket(16);

    expect(bracket.bracketSize).toBe(16);
    expect(bracket.mainBracketSize).toBe(16);
    expect(bracket.fighterCount).toBe(16);
    expect(bracket.byeCount).toBe(0);
    expect(bracket.byeSeedCount).toBe(0);
    expect(bracket.playInMatchCount).toBe(0);
    expect(bracket.hasPlayInRound).toBe(false);
    expect(bracket.rounds).toBe(4);
    expect(bracket.slots).toHaveLength(16);
    expect(bracket.slots.some((slot) => slot.round === 0)).toBe(false);
  });

  it('16 fighters seed 1 vs seed 16 and seed 8 vs seed 9 in round 1', () => {
    const bracket = singleElimBracket(16);
    const r1 = bracket.slots.filter((slot) => slot.round === 1);

    expect(
      r1.find(
        (slot) =>
          (slot.homeSeed === 1 && slot.awaySeed === 16) ||
          (slot.homeSeed === 16 && slot.awaySeed === 1),
      ),
    ).toBeDefined();
    expect(
      r1.find(
        (slot) =>
          (slot.homeSeed === 8 && slot.awaySeed === 9) ||
          (slot.homeSeed === 9 && slot.awaySeed === 8),
      ),
    ).toBeDefined();
  });

  it('16 fighters place seed 1 and seed 2 in opposite halves', () => {
    const bracket = singleElimBracket(16);
    const r1 = bracket.slots.filter((slot) => slot.round === 1);
    const pos1 = r1.findIndex((slot) => slot.homeSeed === 1 || slot.awaySeed === 1);
    const pos2 = r1.findIndex((slot) => slot.homeSeed === 2 || slot.awaySeed === 2);
    const topHalf = (pos: number) => pos < 4;

    expect(topHalf(pos1)).not.toBe(topHalf(pos2));
  });

  it('18 fighters default to a 16-seed main bracket with two play-ins', () => {
    const bracket = singleElimBracket(18);

    expect(bracket.bracketSize).toBe(16);
    expect(bracket.mainBracketSize).toBe(16);
    expect(bracket.playInMatchCount).toBe(2);
    expect(bracket.byeSeedCount).toBe(14);
    expect(bracket.byeCount).toBe(14);
    expect(bracket.hasPlayInRound).toBe(true);
    expect(bracket.rounds).toBe(4);

    const playIns = bracket.slots.filter((slot) => slot.round === 0);
    expect(playIns).toHaveLength(2);
    expect(playIns[0]).toMatchObject({
      position: 1,
      homeSeed: 15,
      awaySeed: 18,
      sourceAType: 'seed',
      sourceBType: 'seed',
    });
    expect(playIns[1]).toMatchObject({
      position: 2,
      homeSeed: 16,
      awaySeed: 17,
      sourceAType: 'seed',
      sourceBType: 'seed',
    });
  });

  it('18 fighter play-in winners map to seed 15 and seed 16 main bracket slots', () => {
    const bracket = singleElimBracket(18);
    const roundOne = bracket.slots.filter((slot) => slot.round === 1);

    const seed15Slot = roundOne.find(
      (slot) => slot.homeSource === 'winner of R0P1' || slot.awaySource === 'winner of R0P1',
    );
    const seed16Slot = roundOne.find(
      (slot) => slot.homeSource === 'winner of R0P2' || slot.awaySource === 'winner of R0P2',
    );

    expect(seed15Slot).toBeDefined();
    expect(seed16Slot).toBeDefined();
    expect(seed15Slot?.homeSeed).not.toBe(15);
    expect(seed15Slot?.awaySeed).not.toBe(15);
    expect(seed16Slot?.homeSeed).not.toBe(16);
    expect(seed16Slot?.awaySeed).not.toBe(16);
  });

  it('13 fighters use an 8-seed main bracket with five play-ins and three direct entries', () => {
    const bracket = singleElimBracket(13);

    expect(bracket.bracketSize).toBe(8);
    expect(bracket.playInMatchCount).toBe(5);
    expect(bracket.byeSeedCount).toBe(3);
    expect(bracket.byeCount).toBe(3);
    expect(bracket.rounds).toBe(3);
    expect(bracket.slots.filter((slot) => slot.round === 0)).toHaveLength(5);
    expect(bracket.slots).toHaveLength(13);
    expect(totalBracketMatches(13)).toBe(12);
  });

  it('direct entries protect the highest seeds from play-ins', () => {
    const bracket = singleElimBracket(13);
    const r0 = bracket.slots.filter((slot) => slot.round === 0);
    const r1 = bracket.slots.filter((slot) => slot.round === 1);

    for (const seed of [1, 2, 3]) {
      expect(r0.some((slot) => slot.homeSeed === seed || slot.awaySeed === seed)).toBe(false);
      expect(r1.some((slot) => slot.homeSeed === seed || slot.awaySeed === seed)).toBe(true);
    }
  });

  it('small non-power-of-two fields use play-ins instead of synthetic bye slots', () => {
    const three = singleElimBracket(3);
    expect(three.bracketSize).toBe(2);
    expect(three.playInMatchCount).toBe(1);
    expect(three.byeSeedCount).toBe(1);
    expect(three.slots.find((slot) => slot.round === 0)).toMatchObject({
      homeSeed: 2,
      awaySeed: 3,
    });

    const five = singleElimBracket(5);
    expect(five.bracketSize).toBe(4);
    expect(five.playInMatchCount).toBe(1);
    expect(five.byeSeedCount).toBe(3);
    expect(five.slots.find((slot) => slot.round === 0)).toMatchObject({
      homeSeed: 4,
      awaySeed: 5,
    });

    const six = singleElimBracket(6);
    expect(six.bracketSize).toBe(4);
    expect(six.playInMatchCount).toBe(2);
    expect(six.byeSeedCount).toBe(2);

    const thirtyOne = singleElimBracket(31);
    expect(thirtyOne.bracketSize).toBe(16);
    expect(thirtyOne.playInMatchCount).toBe(15);
    expect(thirtyOne.byeSeedCount).toBe(1);
  });

  it('round 2+ slots have winner-of source labels', () => {
    const bracket = singleElimBracket(8);
    const r2 = bracket.slots.filter((slot) => slot.round === 2);

    for (const slot of r2) {
      expect(slot.homeSource).toMatch(/^winner of R1P\d+$/);
      expect(slot.awaySource).toMatch(/^winner of R1P\d+$/);
    }
  });

  it('throws for fewer than 2 fighters', () => {
    expect(() => singleElimBracket(1)).toThrow();
    expect(() => singleElimBracket(0)).toThrow();
  });

  it('explicit bracketSize keeps legacy bye behavior', () => {
    const bracket = singleElimBracket(18, { bracketSize: 32 });

    expect(bracket.bracketSize).toBe(32);
    expect(bracket.mainBracketSize).toBe(32);
    expect(bracket.byeCount).toBe(14);
    expect(bracket.byeSeedCount).toBe(14);
    expect(bracket.playInMatchCount).toBe(0);
    expect(bracket.hasPlayInRound).toBe(false);
    expect(bracket.rounds).toBe(5);
  });

  it('explicit bracketSize validates power-of-two and lower-than-field errors', () => {
    expect(() => singleElimBracket(20, { bracketSize: 16 })).toThrow('bracketSize');
    expect(() => singleElimBracket(8, { bracketSize: 12 })).toThrow('power of 2');
  });

  it('caps the main bracket size at 128 while still allowing play-ins below that cap', () => {
    const bracket = singleElimBracket(MAX_SINGLE_ELIM_BRACKET_SIZE + 2);

    expect(bracket.bracketSize).toBe(MAX_SINGLE_ELIM_BRACKET_SIZE);
    expect(bracket.playInMatchCount).toBe(2);
    expect(() => singleElimBracket(MAX_SINGLE_ELIM_BRACKET_SIZE * 2)).toThrow('128');
    expect(() => singleElimBracket(16, { bracketSize: 256 })).toThrow('128');
  });

  it('all actual seeds appear exactly once across initial playable slots', () => {
    const n = 18;
    const bracket = singleElimBracket(n);
    const initialSlots = bracket.slots.filter((slot) => slot.round <= 1);
    const seeds = new Set<number>();

    for (const slot of initialSlots) {
      if (slot.homeSeed !== null) seeds.add(slot.homeSeed);
      if (slot.awaySeed !== null) seeds.add(slot.awaySeed);
    }

    for (let seed = 1; seed <= n; seed++) {
      expect(seeds.has(seed)).toBe(true);
    }
    expect(seeds.size).toBe(n);
  });
});
