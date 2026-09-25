import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Tournament page's server reads send the viewer's login (operator ruling 127a).
 *
 * `…/standings` answers a draft Tournament to anyone outside its club exactly as an unknown one,
 * and this app's server fetches carry no cookie. Without the login a club member checking their
 * draft before publishing got "Tournament not found", like a stranger (`login-cookie.ts`).
 *
 * This package's vitest does not compile TSX, so the pages are read as text.
 */
const TOURNAMENT = join(__dirname, 'e', '[eventSlug]', 't', '[tournamentSlug]');
const read = (file: string) => readFileSync(join(TOURNAMENT, file), 'utf8');

describe('the Tournament page reads its standings as the viewer', () => {
  it.each(['page.tsx', 'stats/page.tsx'])('%s forwards the login to the standings read', (file) => {
    const source = read(file);
    expect(source).toContain("import { requestLoginHeader } from '@/lib/login-cookie';");
    // The read itself carries it: the helper imported but not sent would change nothing. The
    // page's metadata goes through the same read, so it answers a member the same way.
    expect(source).toMatch(
      /\/standings`,\s*\{ cache: 'no-store', headers: await requestLoginHeader\(\) \}/,
    );
  });
});
