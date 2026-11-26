import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LiceWaitingDisplay, type LiceWaitingDisplayNextMatch } from './LiceWaitingDisplay';

/**
 * The piste screen between bouts names the next bout. A tight surface (call 6): each team shows
 * its name with its colour chip, and no logo. A Fighter's side has no colour and no chip.
 */
const next: LiceWaitingDisplayNextMatch = {
  redFighterName: 'Lyon Blades',
  blueFighterName: 'Paris Rapiers',
  redColour: 'green',
  blueColour: 'black',
  roundCode: null,
  matchNumberLabel: 'M2',
  scoringConfig: null,
  tournamentName: 'Team Longsword',
};

function render(nextMatch: LiceWaitingDisplayNextMatch, mirror = false): string {
  return renderToStaticMarkup(
    <LiceWaitingDisplay
      eventName="Open de Lyon"
      liceName="Piste 1"
      nextMatch={nextMatch}
      t={(key) => key}
      mirror={mirror}
    />,
  );
}

/** `TeamChip`'s own shape: its wrapper, the dot of a colour, then a space before the name. */
const chipBefore = (fill: string, name: string) =>
  new RegExp(
    `<span class="inline-flex"><span aria-hidden="true" class="[^"]*${fill}"></span></span> ${name}`,
  );

describe('LiceWaitingDisplay next bout', () => {
  it('shows each team name with its colour chip, and no logo', () => {
    const html = render(next);
    expect(html).toMatch(chipBefore('bg-green-700', 'Lyon Blades'));
    expect(html).toMatch(chipBefore('bg-slate-900', 'Paris Rapiers'));
    expect(html).not.toContain('<img');
  });

  // The stage is near-black: the chip's edge takes the dark scope's light ink, so a black team's
  // chip still shows.
  it('sets the dark scope on the names, for the chip edge on the stage', () => {
    expect(render(next)).toMatch(/<p data-theme="dark"[^>]*>(?:(?!<\/p>).)*Lyon Blades/s);
  });

  it('keeps the chip with its team when the screen is mirrored', () => {
    const html = render(next, true);
    expect(html.indexOf('Paris Rapiers')).toBeLessThan(html.indexOf('Lyon Blades'));
    expect(html).toMatch(chipBefore('bg-slate-900', 'Paris Rapiers'));
  });

  it('shows a Fighter name with no chip', () => {
    const html = render({ ...next, redColour: null, blueColour: null });
    expect(html).not.toMatch(/rounded-full ring-1/);
    expect(html).toContain('Lyon Blades');
  });
});
