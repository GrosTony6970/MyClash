/**
 * The rules and the display the bout screen scores with, from its two sources.
 *
 * The bout's OWN rules (its buttons, its afterblow mode, its format: the copy of its rules it
 * started under) ride on the bout read (`PadBoutRules`, ruling K). The DISPLAY — side colours and
 * quick penalties — is its Tournament's, read from `/match-config` (ruled: display stays on the
 * Tournament). So the screen takes the rules from the bout and the display from the Tournament.
 *
 * A bout read with no rules (kept before they were sent, or a server fault) takes the
 * Tournament's rules as this tablet last read them (ruling J, "last seen"). Neither source: the
 * defaults, as before.
 *
 * `stale` drives the "not confirmed" notice: the rules are not the bout's own, or the display did
 * not come from the server just now. It is false while `/match-config` is still being asked
 * (`undefined`): a notice that flashes on every open says nothing.
 */
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  DEFAULT_SCORING_CONFIG,
  type MatchFormatConfig,
  type TournamentScoringConfig,
} from '@myclash/types';
import type { PadBoutRules } from './bout-read';

/** The Tournament's `/match-config` as the screen holds it. */
export interface HeldMatchConfig {
  scoringConfig: TournamentScoringConfig;
  matchFormat: MatchFormatConfig;
  /** Read from the server just now, not off the tablet. */
  fresh: boolean;
}

export interface RulesOnPad {
  scoringConfig: TournamentScoringConfig;
  matchFormat: MatchFormatConfig;
  stale: boolean;
}

/**
 * The screen's `/match-config` as `rulesOnPad` takes it. A bout naming no Tournament has none to
 * ask: settled with nothing, or the screen would wait forever on the defaults and never say so.
 * A config already held stays when a later read of the bout loses its summary (and with it the
 * Tournament's id): the side colours must not turn to the defaults mid-bout.
 */
export function settledConfig(
  tournamentId: string | null | undefined,
  config: HeldMatchConfig | null | undefined,
): HeldMatchConfig | null | undefined {
  return !tournamentId && config === undefined ? null : config;
}

/**
 * @param config `undefined` while asked; `null` when settled with nothing (never read, or a bout
 *   naming no Tournament); else the answer.
 */
export function rulesOnPad(
  rules: PadBoutRules | undefined,
  config: HeldMatchConfig | null | undefined,
): RulesOnPad {
  const stale = config !== undefined && (!rules || config === null || !config.fresh);
  const tournament = config ?? null;
  if (!rules) {
    return {
      scoringConfig: tournament?.scoringConfig ?? DEFAULT_SCORING_CONFIG,
      matchFormat: tournament?.matchFormat ?? DEFAULT_MATCH_FORMAT_CONFIG,
      stale,
    };
  }
  const display = tournament?.scoringConfig ?? DEFAULT_SCORING_CONFIG;
  return {
    scoringConfig: { ...display, afterblowMode: rules.afterblowMode, buttons: rules.buttons },
    matchFormat: rules.matchFormat,
    stale,
  };
}
