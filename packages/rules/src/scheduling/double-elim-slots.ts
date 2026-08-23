/**
 * packages/rules/src/scheduling/double-elim-slots.ts
 *
 * Slot shapes and per-section builders for the double-elimination generator.
 * Split out of `double-elim.ts` so that file stays focused on sizing,
 * validation, and assembly. Pure — no DB, no I/O.
 */

export type SlotSourceType = 'seed' | 'winner_of' | 'loser_of' | 'bye';

export interface DoubleElimSlot {
  /** Absolute round number (0 = play-in) */
  round: number;
  /** 1-indexed position within round */
  position: number;
  /** Bracket section. Play-in slots are part of the winners' side. */
  section: 'WB' | 'LB' | 'GF' | 'RESET';
  /** Source description for home/top slot */
  homeSource: string;
  /** Source description for away/bottom slot */
  awaySource: string;
  /** Source type for home slot */
  sourceAType: SlotSourceType;
  /** Source type for away slot */
  sourceBType: SlotSourceType;
  /** Always false — double-elim brackets never carry byes. Retained so the
   *  slot shape stays interchangeable with the single-elim generator. */
  isBye: boolean;
  /** Seed number for home slot (seed-sourced slots only) */
  homeSeed: number | null;
  /** Seed number for away slot (seed-sourced slots only) */
  awaySeed: number | null;
}

/**
 * Standard seeding order — same algorithm as single-elim.
 * Returns [homeSeed, awaySeed] pairs for WB round 1.
 */
function buildSeedingOrder(size: number): Array<[number, number]> {
  if (size === 2) return [[1, 2]];

  let seeds = [1];
  while (seeds.length < size) {
    const complement = seeds.length * 2 + 1;
    const newSeeds: number[] = [];
    for (const s of seeds) {
      newSeeds.push(s);
      newSeeds.push(complement - s);
    }
    seeds = newSeeds;
  }

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < seeds.length; i += 2) {
    pairs.push([seeds[i]!, seeds[i + 1]!]);
  }
  return pairs;
}

/** Shared defaults so each section builder only states what differs. */
function slot(
  partial: Omit<DoubleElimSlot, 'isBye' | 'homeSeed' | 'awaySeed'> &
    Partial<Pick<DoubleElimSlot, 'homeSeed' | 'awaySeed'>>,
): DoubleElimSlot {
  return { isBye: false, homeSeed: null, awaySeed: null, ...partial };
}

/**
 * Round 0. Mirrors single-elim: the lowest direct seed plays the lowest-ranked
 * fighter, so the strongest qualifiers are protected from the play-in.
 */
export function buildPlayInSlots(
  fighterCount: number,
  byeSeedCount: number,
  playInMatchCount: number,
): DoubleElimSlot[] {
  const out: DoubleElimSlot[] = [];
  for (let pos = 1; pos <= playInMatchCount; pos++) {
    const homeSeed = byeSeedCount + pos;
    const awaySeed = fighterCount - pos + 1;
    out.push(
      slot({
        round: 0,
        position: pos,
        section: 'WB',
        homeSeed,
        awaySeed,
        homeSource: `seed ${homeSeed}`,
        awaySource: `seed ${awaySeed}`,
        sourceAType: 'seed',
        sourceBType: 'seed',
      }),
    );
  }
  return out;
}

/**
 * WB round 1 (seeds, with play-in winners filling the low seats) plus rounds
 * 2..wbRounds (winner-of chains).
 *
 * The `WB` prefix on the round-0 ref is mandatory: BracketAdvanceService's
 * buildSelfRef stamps a completed round-0 slot as `WBR0P{n}` for double_elim
 * phases, so a bare `winner of R0P1` would never match and the play-in
 * winners would never reach the bracket.
 */
export function buildWinnersSlots(
  bracketSize: number,
  byeSeedCount: number,
  hasPlayInRound: boolean,
  wbRounds: number,
): DoubleElimSlot[] {
  const out: DoubleElimSlot[] = [];

  const seedPairs = buildSeedingOrder(bracketSize);
  for (let pos = 0; pos < seedPairs.length; pos++) {
    const [homeSeed, awaySeed] = seedPairs[pos]!;
    const homePlayIn = hasPlayInRound && homeSeed > byeSeedCount ? homeSeed - byeSeedCount : null;
    const awayPlayIn = hasPlayInRound && awaySeed > byeSeedCount ? awaySeed - byeSeedCount : null;
    out.push(
      slot({
        round: 1,
        position: pos + 1,
        section: 'WB',
        homeSeed: homePlayIn ? null : homeSeed,
        awaySeed: awayPlayIn ? null : awaySeed,
        homeSource: homePlayIn ? `winner of WBR0P${homePlayIn}` : `seed ${homeSeed}`,
        awaySource: awayPlayIn ? `winner of WBR0P${awayPlayIn}` : `seed ${awaySeed}`,
        sourceAType: homePlayIn ? 'winner_of' : 'seed',
        sourceBType: awayPlayIn ? 'winner_of' : 'seed',
      }),
    );
  }

  for (let wbRound = 2; wbRound <= wbRounds; wbRound++) {
    const matchCount = bracketSize / Math.pow(2, wbRound);
    for (let pos = 1; pos <= matchCount; pos++) {
      out.push(
        slot({
          round: wbRound,
          position: pos,
          section: 'WB',
          homeSource: `winner of WBR${wbRound - 1}P${(pos - 1) * 2 + 1}`,
          awaySource: `winner of WBR${wbRound - 1}P${(pos - 1) * 2 + 2}`,
          sourceAType: 'winner_of',
          sourceBType: 'winner_of',
        }),
      );
    }
  }

  return out;
}

/**
 * The two source refs for one losers-bracket slot at LB round k, position p.
 *
 * `entryRound` is the first WB round whose losers drop in — 1 without a
 * repechage cutoff, deeper with one. Everything else re-indexes off it: the
 * drop round reads WB `entryRound`, and each mixed round reads the WB round
 * exactly k/2 deeper than that.
 */
function lbSources(
  k: number,
  pos: number,
  entryRound: number,
): Pick<DoubleElimSlot, 'homeSource' | 'awaySource' | 'sourceAType' | 'sourceBType'> {
  if (k === 1) {
    // Drop round: position j pairs the entry-round losers at positions 2j-1, 2j.
    return {
      homeSource: `loser of WBR${entryRound}P${2 * pos - 1}`,
      awaySource: `loser of WBR${entryRound}P${2 * pos}`,
      sourceAType: 'loser_of',
      sourceBType: 'loser_of',
    };
  }
  if (k % 2 === 0) {
    // Mixed round: LB survivors meet the losers dropping out of WB round
    // (entryRound - 1) + k/2 + 1. Both sides have the same match count, so the
    // positions map 1:1.
    return {
      homeSource: `winner of LBR${k - 1}P${pos}`,
      awaySource: `loser of WBR${entryRound + k / 2}P${pos}`,
      sourceAType: 'winner_of',
      sourceBType: 'loser_of',
    };
  }
  // Odd rounds (k >= 3): consolidation within the LB.
  return {
    homeSource: `winner of LBR${k - 1}P${2 * pos - 1}`,
    awaySource: `winner of LBR${k - 1}P${2 * pos}`,
    sourceAType: 'winner_of',
    sourceBType: 'winner_of',
  };
}

/**
 * LB round k (1-indexed within the LB) sits at absolute round wbRounds + k —
 * unchanged by any cutoff, so the advancement ref strings stay stable.
 *
 * Match counts key off `repechageEntrySize`, not the bracket size: a cutoff of
 * K makes the losers bracket structurally identical to a K-sized bracket's LB.
 * `lbRounds` already carries any bronze-mode truncation.
 */
export function buildLosersSlots(
  repechageEntrySize: number,
  entryRound: number,
  wbRounds: number,
  lbRounds: number,
): DoubleElimSlot[] {
  const out: DoubleElimSlot[] = [];
  for (let k = 1; k <= lbRounds; k++) {
    const matchCount = repechageEntrySize / (4 * Math.pow(2, Math.floor((k - 1) / 2)));
    for (let pos = 1; pos <= matchCount; pos++) {
      out.push(
        slot({
          round: wbRounds + k,
          position: pos,
          section: 'LB',
          ...lbSources(k, pos, entryRound),
        }),
      );
    }
  }
  return out;
}

/**
 * Grand final, plus the conditional reset slot when it is enabled.
 *
 * Returns NOTHING in bronze mode: there, the winners-bracket final decides
 * gold and silver on its own and the repechage plays for bronze, so the
 * losers-bracket winner never meets the champion.
 */
export function buildFinalsSlots(
  wbRounds: number,
  lbRounds: number,
  grandFinalReset: boolean,
  secondChanceTarget: 'gold' | 'bronze' = 'gold',
): DoubleElimSlot[] {
  if (secondChanceTarget === 'bronze') return [];

  const gfRound = wbRounds + lbRounds + 1;
  // A 2-fighter bracket has no losers bracket at all (lbRounds === 0): the WB
  // final's loser IS the second-chance entrant, so the GF reads its opponent
  // straight off that match instead of a non-existent LBR0.
  const out: DoubleElimSlot[] = [
    slot({
      round: gfRound,
      position: 1,
      section: 'GF',
      homeSource: `winner of WBR${wbRounds}P1`,
      awaySource: lbRounds > 0 ? `winner of LBR${lbRounds}P1` : `loser of WBR${wbRounds}P1`,
      sourceAType: 'winner_of',
      sourceBType: lbRounds > 0 ? 'winner_of' : 'loser_of',
    }),
  ];

  if (grandFinalReset) {
    out.push(
      slot({
        round: gfRound + 1,
        position: 1,
        section: 'RESET',
        homeSource: 'loser of GF',
        awaySource: 'winner of GF',
        sourceAType: 'loser_of',
        sourceBType: 'winner_of',
      }),
    );
  }

  return out;
}
