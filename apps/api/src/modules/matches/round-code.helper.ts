import { formatRoundCode } from '@myclash/types';

/**
 * Single canonical wrapper around `formatRoundCode` so every backend
 * mapper that returns a match shape (`getMatchSummary`,
 * `listPoolsWithMatches`, `staff.service.mapDisplayMatch /
 * mapSummaryMatch`, …) builds the same `roundCode` from the same row
 * inputs. Two surfaces previously diverged — pool list re-formatted
 * client-side, scoreboard returned the raw label — leaving the same
 * match readable as two different identifiers.
 *
 * The helper takes a view-row-like shape and forwards to the shared
 * pure formatter in `@myclash/types`. Match number falls back to
 * `round_number` when `match_number_label` is null (the historical
 * default for placeholder bracket rows).
 */
export interface RoundCodeRowInput {
  weapon: string | null;
  poolNumber: number | null;
  bracketRound: number | null;
  bracketSize: number | null;
  matchNumberLabel: string | null;
  roundNumber: number | null;
  /**
   * `swiss_rounds.round_number` — the S segment. Optional so the non-Swiss
   * callers stay untouched, but every mapper that can see a Swiss match must
   * pass it: without it the live surfaces would render a segment-less `LSW-M1`
   * while the exports render `LSW-S3-M2`, which is precisely the two-identities
   * divergence this helper exists to prevent.
   */
  swissRound?: number | null;
  /**
   * Double-elim round split from `phases.config_json`. Absent for single-elim
   * phases, which keeps their codes byte-identical. Present, it switches the
   * label to the section-aware form (WBF / LB3 / GF) — a double-elim bracket
   * has three rounds that a single-elim label would all call "F".
   */
  wbRounds?: number | null;
  lbRounds?: number | null;
}

export function buildRoundCode(input: RoundCodeRowInput): string {
  return formatRoundCode({
    weapon: input.weapon,
    poolNumber: input.poolNumber,
    bracketRound: input.bracketRound,
    bracketSize: input.bracketSize,
    swissRound: input.swissRound ?? null,
    matchNumber: input.matchNumberLabel ?? input.roundNumber,
    wbRounds: input.wbRounds ?? null,
    lbRounds: input.lbRounds ?? null,
  });
}

/**
 * Pull the round-code-relevant bits out of a `phases.config_json` blob.
 * One reader, so every mapper that builds a round code resolves the bracket
 * shape the same way instead of each picking its own subset of the config.
 */
export function bracketCodeConfig(configJson: unknown): {
  bracketSize: number | null;
  wbRounds: number | null;
  lbRounds: number | null;
} {
  const c = (configJson ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    bracketSize: num(c['bracketSize']),
    wbRounds: num(c['wbRounds']),
    lbRounds: num(c['lbRounds']),
  };
}

/**
 * The three embeds of a `matches` select that {@link roundCodeFromMatchRow}
 * reads besides the phase's `config_json` and the Tournament's `weapon`.
 */
export const ROUND_CODE_EMBEDS =
  'pools(sort_order),bracket_slots(round),swiss_rounds(round_number)';

/**
 * Every input of {@link roundCodeFromMatchRow}, for a `matches` select (or a
 * `matches ( … )` embed) that reads no phase or pool of its own.
 */
export const ROUND_CODE_INPUTS = `phases(config_json,tournaments(weapon)),${ROUND_CODE_EMBEDS}`;

/**
 * Round code from a raw `matches` row: the name a bout shows to people
 * (`LSW-P4-M1`), never its stored label (`L1-PD-M01`). The row must carry
 * `phases(config_json,tournaments(weapon))` and {@link ROUND_CODE_EMBEDS}; a
 * missing embed drops that segment of the code without an error.
 *
 * Was copy-pasted verbatim into `mapCurrentMatch`, `mapNeighborRow` and
 * `resolveNextMatchOnLice`. One reader means the three can no longer drift
 * apart on bracket or Swiss labels.
 */
/**
 * The code of a bout that has a number, null for one with none (or no bout at
 * all): a notice then says its stand-in ("your match") rather than `???`.
 */
export function roundCodeOrNull(match: object | null | undefined): string | null {
  if (!match || !(match as Record<string, unknown>)['match_number_label']) return null;
  return roundCodeFromMatchRow(match);
}

export function roundCodeFromMatchRow(match: object): string {
  const row = match as Record<string, unknown>;
  const phase = row['phases'] as {
    config_json?: Record<string, unknown> | null;
    tournaments?: { weapon?: string };
  } | null;
  const pool = row['pools'] as { sort_order?: number } | null;
  const bracketSlot = row['bracket_slots'] as { round?: number } | null;
  const swissRoundEmbed = row['swiss_rounds'] as { round_number?: number } | null;
  const phaseCfg = phase?.config_json ?? null;
  const sizeRaw = (phaseCfg?.['bracketSize'] ?? phaseCfg?.['mainBracketSize']) as
    number | undefined;
  const { wbRounds, lbRounds } = bracketCodeConfig(phaseCfg);
  return buildRoundCode({
    weapon: phase?.tournaments?.weapon ?? null,
    poolNumber: typeof pool?.sort_order === 'number' ? pool.sort_order + 1 : null,
    bracketRound: typeof bracketSlot?.round === 'number' ? bracketSlot.round : null,
    swissRound:
      typeof swissRoundEmbed?.round_number === 'number' ? swissRoundEmbed.round_number : null,
    bracketSize: typeof sizeRaw === 'number' ? sizeRaw : null,
    wbRounds,
    lbRounds,
    matchNumberLabel: (row['match_number_label'] as string | null) ?? null,
    roundNumber: null,
  });
}
