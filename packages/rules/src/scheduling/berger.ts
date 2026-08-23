/**
 * packages/rules/src/scheduling/berger.ts
 *
 * Berger table (circle method) for round-robin tournament scheduling.
 * Generates all matches for a pool in a deterministic, balanced order.
 *
 * ARCHITECTURE.md §11quater: "Generate every match in a pool with a
 * deterministic order (Berger tables)."
 *
 * Pure function — no DB, no I/O.
 *
 * Algorithm (circle method):
 *   - Fix one player (the "pivot") at position 0.
 *   - Rotate the remaining N-1 players clockwise each round.
 *   - Each round generates N/2 matches (for even N).
 *   - For odd N, add a "bye" player to make it even.
 *
 * Reference: https://en.wikipedia.org/wiki/Round-robin_tournament#Circle_method
 */

export interface BergerMatch {
  round: number;
  /** 0-indexed position within the round */
  matchInRound: number;
  /** Global sequence number (1-indexed) */
  sequence: number;
  homeIndex: number; // index into the registrationIds array
  awayIndex: number;
  /** Match label: `L{lice}-P{pool}-M{seq}`, seq zero-padded — see below. */
  label: string;
}

export interface BergerScheduleOptions {
  liceLabel?: string; // e.g. "1" → "L1"
  poolLabel?: string; // e.g. "A" → "PA"
}

/**
 * Width of the sequence inside a pool's match labels, so a label sorts the way
 * the number inside it does.
 *
 * Three reads order a pool's matches by `match_number_label` in SQL: the
 * spectator display's "Fight X / Y", and the two scheduling reads that hand out
 * times. Postgres sorts that column as TEXT, which puts M10 ahead of M2 the
 * moment a pool reaches ten bouts — and a pool of five fighters is ten bouts,
 * so that is the ordinary case rather than a large-pool edge.
 *
 * The width comes from the pool's own total: no padding below ten bouts, three
 * digits past ninety-nine. Consumers that read the number back out of a label
 * parse it with `Number`/`parseInt`, which ignore the zeros.
 */
function labelWidth(n: number): number {
  return String(totalMatches(n)).length;
}

/**
 * Generate a complete round-robin schedule for N players using the Berger
 * (circle method) algorithm.
 *
 * @param n         Number of players in the pool
 * @param options   Label options for match naming
 * @returns         Array of matches in round order
 */
export function bergerSchedule(n: number, options: BergerScheduleOptions = {}): BergerMatch[] {
  if (n < 2) throw new Error('Need at least 2 players for a round-robin');

  const lice = options.liceLabel ?? '1';
  const pool = options.poolLabel ?? 'A';

  // For odd N, add a bye (index N) to make it even
  const isOdd = n % 2 !== 0;
  const size = isOdd ? n + 1 : n;
  const rounds = size - 1;
  const matchesPerRound = size / 2;

  // Build the rotation array: [0, 1, 2, ..., size-1]
  // Position 0 is the fixed pivot; positions 1..size-1 rotate.
  const rotation = Array.from({ length: size }, (_, i) => i);

  const width = labelWidth(n);

  const matches: BergerMatch[] = [];
  let sequence = 1;

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < matchesPerRound; i++) {
      const home = rotation[i]!;
      const away = rotation[size - 1 - i]!;

      // Skip matches involving the bye player
      if (isOdd && (home === n || away === n)) continue;

      matches.push({
        round: round + 1,
        matchInRound: i,
        sequence,
        homeIndex: home,
        awayIndex: away,
        label: `L${lice}-P${pool}-M${String(sequence).padStart(width, '0')}`,
      });
      sequence++;
    }

    // Rotate positions 1..size-1 clockwise (position 0 stays fixed)
    const last = rotation[size - 1]!;
    for (let i = size - 1; i > 1; i--) {
      rotation[i] = rotation[i - 1]!;
    }
    rotation[1] = last;
  }

  return matches;
}

/**
 * Total number of matches in a round-robin pool of N players.
 * Formula: N * (N-1) / 2
 */
export function totalMatches(n: number): number {
  return (n * (n - 1)) / 2;
}

/**
 * Number of rounds in a round-robin pool of N players.
 * Even N: N-1 rounds. Odd N: N rounds.
 */
export function totalRounds(n: number): number {
  return n % 2 === 0 ? n - 1 : n;
}
