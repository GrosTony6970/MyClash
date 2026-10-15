import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Both sides of a bout being fought are filled, so a side the server sends with no name is a
 * person with no name: "Unknown fighter" (`nameOrUnknown`), never a `?`. The next bout of a piste
 * is not held here: its empty side may be a bracket slot nobody has reached yet, and the server
 * sends that the same way, so its words wait for the server to tell the two apart.
 */
const EVENT_PAGES = join(__dirname, '..');
const read = (...path: string[]) => readFileSync(join(EVENT_PAGES, ...path), 'utf8');

describe('a bout being fought names a side with no name', () => {
  it('on the live card of the home page and the live board', () => {
    const card = read('home', '_components', 'LiveMatchCard.tsx');
    expect(card).not.toContain("?? '?'");
    expect(card).toContain("nameOrUnknown(match.redFighterName, 'fighter', t)");
    expect(card).toContain("nameOrUnknown(match.blueFighterName, 'fighter', t)");
    expect(read('home', '_components', 'LiveNowSection.tsx')).toMatch(
      /<LiveMatchCard[^>]*t=\{t\}/s,
    );
    expect(read('live', 'page.tsx')).toMatch(/<LiveMatchCard[^>]*t=\{t\}/s);
  });

  it("on the live board's piste tiles", () => {
    const board = read('live', 'page.tsx');
    expect(board).not.toContain("runningMatch.redFighterName ?? '?'");
    expect(board).toContain("nameOrUnknown(ls.runningMatch.redFighterName, 'fighter', t)");
    expect(board).toContain("nameOrUnknown(ls.runningMatch.blueFighterName, 'fighter', t)");
  });

  it("on the display hub's live tiles", () => {
    const hub = read('display', 'NowLiveSection.tsx');
    expect(hub).not.toContain("?? '?'");
    expect(hub).toContain("nameOrUnknown(match.redFighterName, 'fighter', t)");
    expect(hub).toContain("nameOrUnknown(match.blueFighterName, 'fighter', t)");
  });
});
