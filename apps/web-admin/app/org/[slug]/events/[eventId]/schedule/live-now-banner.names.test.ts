import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Both sides of a bout being fought are filled, so a side with no name is a person with no
 * name: "Unknown fighter", never a `?`. The next bout is not held here: its empty side may be a
 * bracket slot nobody has reached yet, and the server sends that the same way.
 */
describe('the live banner names a side of the running bout with no name', () => {
  it('through nameOrUnknown, not a question mark', () => {
    const banner = readFileSync(join(__dirname, 'live-now-banner.tsx'), 'utf8');
    expect(banner).not.toContain("runningMatch.redFighterName ?? '?'");
    expect(banner).toContain("nameOrUnknown(ls.runningMatch.redFighterName, 'fighter', t)");
    expect(banner).toContain("nameOrUnknown(ls.runningMatch.blueFighterName, 'fighter', t)");
  });
});
