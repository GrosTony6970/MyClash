import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The public match page's live channel carries the bout's protests.
 *
 * `pnpm db:realtime-bindings` holds one direction only: a bound table must be
 * published. A binding that is simply missing passes it, and the page then
 * shows a protest only at its next poll or reload. So the bindings are pinned
 * here, as text: web-public's vitest does not compile this hook.
 *
 * Each pin holds the whole binding: the event, the table, the bout's filter
 * and the handler that merges the raw row by id, as the card bindings do.
 */
const channel = readFileSync(resolve(__dirname, 'use-match-live-channel.ts'), 'utf8');

describe("the public match page's live channel", () => {
  it('adds a new protest of the bout once, by its id', () => {
    expect(channel).toMatch(
      /event: 'INSERT',\s+schema: 'public',\s+table: 'match_protests',\s+filter: `match_id=eq\.\$\{matchId\}`,\s+\},\s+\(payload\) => \{\s+const raw = payload\.new as MatchProtest;\s+setProtests\(\(prev\) => \{\s+if \(prev\.some\(\(protest\) => protest\.id === raw\.id\)\) return prev;\s+return \[\.\.\.prev, raw\];/,
    );
  });

  it('replaces a changed protest of the bout by its id (a void lands this way)', () => {
    expect(channel).toMatch(
      /event: 'UPDATE',\s+schema: 'public',\s+table: 'match_protests',\s+filter: `match_id=eq\.\$\{matchId\}`,\s+\},\s+\(payload\) => \{\s+const raw = payload\.new as MatchProtest;\s+setProtests\(\(prev\) => prev\.map\(\(protest\) => \(protest\.id === raw\.id \? raw : protest\)\)\);/,
    );
  });
});
