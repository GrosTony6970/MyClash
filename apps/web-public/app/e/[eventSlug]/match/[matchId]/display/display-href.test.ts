import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boutDisplayHref } from './display-href';

describe('boutDisplayHref', () => {
  it("is the bout's own TV address", () => {
    expect(boutDisplayHref('spring-open', 'm-42')).toBe('/e/spring-open/match/m-42/display');
  });
});

/**
 * The single-bout TV reads its bout on the server, and the browser harness runs
 * no API: no stubbed browser story can open it. So its wiring is pinned as
 * text. The mechanism (told once, no page load) has its browser stories on the
 * piste TV and on the organiser's popup, which share the scoreboard.
 */
describe('the single-bout TV moves to the next bout without a page load', () => {
  const view = readFileSync(join(__dirname, 'display-view.tsx'), 'utf8');

  it('goes to the next bout by the router, never by a page load', () => {
    expect(view).toContain('router.replace(boutDisplayHref(eventSlug, nextMatchId))');
    expect(view).not.toContain('window.location');
  });

  it('hands the scoreboard that move unless the screen brings its own', () => {
    expect(view).toContain('onBoutOver={onBoutOver ?? toNextBout}');
  });
});
