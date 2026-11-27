/**
 * The rounds hook places the tablet's cards by side key (`sideKey` over the bout's
 * Registration and team ids), and the score on the pad moves for the side carded.
 *
 * Lyon Blades fight Paris Rapiers in a team Pool. The scorekeeper gives Paris a card worth a
 * point with no network: the provisional score under Paris's numeral drops by one. A team has
 * no Registration, so a hook that passed the Registration ids put the card on nobody.
 *
 * web-staff has no React test setup: the hook is drawn once on the server renderer, which runs
 * its memos and its state (no effect), and the view it answers is read from the markup.
 */
import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchInfo } from '../components/MatchView';
import { cardAgainstRed, FORMAT } from '../offline/pad-series.fixtures';
import type { MatchScoringData } from './useMatchScoringData';
import { usePadRounds } from './usePadRounds';

const TEAM_BOUT: MatchInfo = {
  id: 'm1',
  matchNumberLabel: 'L1-P1-M1',
  status: 'running',
  redRegistrationId: null,
  blueRegistrationId: null,
  redTeamId: 'team-lyon',
  blueTeamId: 'team-paris',
  redScore: 3,
  blueScore: 2,
  phaseType: 'pool',
  eventOver: false,
};

/** A card the tablet holds against Paris, worth one point. */
const parisCard = { ...cardAgainstRed(1), registration_id: null, team_id: 'team-paris' };

/** The score the hook shows, read off one draw. */
function drawn(match: MatchInfo, queuedPenalties: MatchScoringData['pendingPenalties']) {
  function Probe() {
    const { series } = usePadRounds({
      match,
      matchFormat: FORMAT,
      scoring: {
        activeExchanges: [],
        activePenalties: [],
        pendingExchanges: [],
        pendingPenalties: queuedPenalties,
        queuedRoundPresses: [],
      },
      clockState: null,
      held: false,
      syncEngine: null,
      pressed: () => undefined,
      setError: () => undefined,
      readBout: () => undefined,
      t: (key) => key,
    });
    const shown = [series.redScore, series.blueScore, series.redQueued, series.blueQueued];
    return createElement('output', null, shown.join(' '));
  }
  return renderToStaticMarkup(createElement(Probe));
}

describe('usePadRounds', () => {
  it('a team’s queued card moves its own team’s score, and no one else’s', () => {
    expect(drawn(TEAM_BOUT, [parisCard])).toBe('<output>3 1 0 -1</output>');
  });

  it('a bout with nothing queued shows the server’s score', () => {
    expect(drawn(TEAM_BOUT, [])).toBe('<output>3 2 0 0</output>');
  });
});
