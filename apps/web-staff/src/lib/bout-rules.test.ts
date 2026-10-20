import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  DEFAULT_SCORING_CONFIG,
  type MatchFormatConfig,
  type TournamentScoringConfig,
} from '@myclash/types';
import type { PadBoutRules } from './bout-read';
import { rulesOnPad, settledConfig, type HeldMatchConfig } from './bout-rules';

const button = (value: number) => ({ label: `+${value}`, value, visible: true });

/** The bout's own copy: +3, deductive, cap 5. */
const RULES: PadBoutRules = {
  matchFormat: { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 5 },
  afterblowMode: 'deductive',
  buttons: { clean: [button(3), button(1)], afterblow: [] },
  cardRulesetId: 'cards-a',
};

/** Its Tournament now: +2, full, cap 7, and its own colours and quick penalties. */
const TOURNAMENT = {
  afterblowMode: 'full',
  buttons: { clean: [button(2), button(1)], afterblow: [] },
  display: { sideColors: { red: 'white', blue: 'black' }, quickPenalties: [3] },
} as unknown as TournamentScoringConfig;
const config = (fresh: boolean): HeldMatchConfig => ({
  scoringConfig: TOURNAMENT,
  matchFormat: { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 7 } as MatchFormatConfig,
  fresh,
});

describe('rulesOnPad', () => {
  // A bout keeps the rules it started under (ruled); display stays on the Tournament (ruled).
  it('scores with the bout’s own rules under its Tournament’s display, and says nothing', () => {
    const on = rulesOnPad(RULES, config(true));

    expect(on.scoringConfig).toEqual({
      afterblowMode: 'deductive',
      buttons: RULES.buttons,
      display: TOURNAMENT.display,
    });
    expect(on.matchFormat.pointCap).toBe(5);
    expect(on.stale).toBe(false);
  });

  it('says so when the display came off the tablet', () => {
    expect(rulesOnPad(RULES, config(false))).toMatchObject({ stale: true });
  });

  it('scores with the bout’s own rules under the default display when none is held, and says so', () => {
    const on = rulesOnPad(RULES, null);

    expect(on.scoringConfig.buttons).toEqual(RULES.buttons);
    expect(on.scoringConfig.display).toEqual(DEFAULT_SCORING_CONFIG.display);
    expect(on.matchFormat.pointCap).toBe(5);
    expect(on.stale).toBe(true);
  });

  // Ruling J: a bout read without its own rules takes its Tournament's, last seen.
  it('takes the Tournament’s rules for a bout without its own, and says so though fresh', () => {
    const on = rulesOnPad(undefined, config(true));

    expect(on.scoringConfig).toBe(TOURNAMENT);
    expect(on.matchFormat.pointCap).toBe(7);
    expect(on.stale).toBe(true);
  });

  it('falls to the defaults with neither, and says so', () => {
    expect(rulesOnPad(undefined, null)).toEqual({
      scoringConfig: DEFAULT_SCORING_CONFIG,
      matchFormat: DEFAULT_MATCH_FORMAT_CONFIG,
      stale: true,
    });
    // What a Tournament with no scoring config plays (operator ruling 47), as a literal.
    expect(rulesOnPad(undefined, null).scoringConfig.afterblowMode).toBe('full');
  });

  // No notice that flashes on every open while `/match-config` is asked.
  it('says nothing while the Tournament’s config is still asked', () => {
    expect(rulesOnPad(RULES, undefined)).toMatchObject({ stale: false });
    expect(rulesOnPad(undefined, undefined)).toMatchObject({ stale: false });
  });
});

describe('settledConfig', () => {
  // A bout naming no Tournament asks nothing: waiting on it forever would score on the
  // defaults and never say so.
  it('settles with nothing for a bout naming no Tournament', () => {
    expect(settledConfig(undefined, undefined)).toBeNull();
    expect(settledConfig('tournament-1', undefined)).toBeUndefined();
  });

  // A re-read of the bout whose summary did not land names no Tournament: the side colours
  // must not turn to the defaults mid-bout.
  it('keeps a config already held when the bout loses its Tournament’s id', () => {
    expect(settledConfig(undefined, config(true))).toEqual(config(true));
    expect(settledConfig('tournament-1', null)).toBeNull();
  });
});
