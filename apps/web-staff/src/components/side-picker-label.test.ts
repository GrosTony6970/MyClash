/**
 * The pad's side pickers name the kind of side they pick (ADR-022, call 5).
 *
 * Lyon Blades meets Paris Rapiers in a team Pool. The scorekeeper opens the forfeit panel, then
 * the direct card panel: each picker says "Team", as the card or the forfeit goes to a team. On a
 * Fighters' bout the pickers still say "Fighter".
 *
 * web-staff has no React test setup: each panel is drawn once on the server renderer, with its
 * words stood in by their keys.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DirectCardPanel, NO_DIRECT_CARD_DRAFT } from './DirectCardPanel';
import { ForfeitPanel } from './ForfeitPanel';

vi.mock('@myclash/next-i18n/client', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const TEAM_SIDES = {
  redRegistrationId: null,
  blueRegistrationId: null,
  redTeamId: 'team-lyon',
  blueTeamId: 'team-paris',
};
const FIGHTER_SIDES = {
  redRegistrationId: 'reg-anna',
  blueRegistrationId: 'reg-bruno',
  redTeamId: null,
  blueTeamId: null,
};
type Sides = typeof TEAM_SIDES | typeof FIGHTER_SIDES;

const forfeitPanel = (sides: Sides) =>
  renderToStaticMarkup(
    createElement(ForfeitPanel, { matchId: 'm1', sides, redName: 'Red', blueName: 'Blue' }),
  );

const cardPanel = (sides: Sides) =>
  renderToStaticMarkup(
    createElement(DirectCardPanel, {
      draft: NO_DIRECT_CARD_DRAFT,
      onDraft: () => undefined,
      matchId: 'm1',
      sides,
      redName: 'Red',
      blueName: 'Blue',
      ruleSetCards: [],
      nextSequence: 1,
      clockTimeMs: null,
      bout: {} as never,
      round: 1,
      online: true,
      disabled: false,
      onClose: () => undefined,
      onRecorded: () => undefined,
    }),
  );

describe.each([
  ['the forfeit panel', forfeitPanel],
  ['the direct card panel', cardPanel],
])('%s', (_name, draw) => {
  it('names a team on a team bout', () => {
    const panel = draw(TEAM_SIDES);
    expect(panel).toContain('scoring.forfeits.team');
    expect(panel).not.toContain('scoring.forfeits.fighter');
  });

  it('names a Fighter on a Fighters’ bout', () => {
    const panel = draw(FIGHTER_SIDES);
    expect(panel).toContain('scoring.forfeits.fighter');
    expect(panel).not.toContain('scoring.forfeits.team');
  });
});
