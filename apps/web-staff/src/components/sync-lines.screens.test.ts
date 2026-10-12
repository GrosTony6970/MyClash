/**
 * The lines that say "is it sent?" are 14px (quick win P14; operator,
 * 2026-10-12): "not yet sent" and "not confirmed" under the score, and the
 * messages of the clock and of the undo. They were 11px and 12px, on the one
 * surface whose rule is "fewer things, larger" (docs/design/web-staff.md).
 *
 * The first is measured in a browser (`tests/a11y/pad-sync-lines-readable.spec.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');

describe('the lines under a score', () => {
  const column = read('ScoringColumn.tsx');

  it('"not confirmed" is 14px', () => {
    expect(column).toMatch(
      /data-testid="score-unconfirmed"\s+className="mt-1 text-center text-sm font-bold /,
    );
  });

  it('"not yet sent" is 14px', () => {
    expect(column).toMatch(
      /data-unpriced-cards=\{queuedCards\.unpriced\}\s+className="mt-1 text-center text-sm font-semibold /,
    );
  });
});

describe('the messages under the clock', () => {
  const controls = read('ScoringCenterControls.tsx');

  it('a refused clock press is said in 14px', () => {
    expect(controls).toContain(
      '{clockError && <p className="text-center text-sm text-danger">{clockError}</p>}',
    );
  });

  it('what the undo did, or could not do, is said in 14px', () => {
    expect(controls).toMatch(
      /\{undo\.error && \(\s+<p className="text-center text-sm text-danger" role="alert">/,
    );
    expect(controls).toMatch(
      /\{undo\.notice && \(\s+<p className="text-center text-sm text-info" role="status">/,
    );
  });
});

// The same messages, said on the screen between two rounds.
describe('the messages of the round-break screen', () => {
  const dialogs = read('MatchPauseDialogs.tsx');

  it('are 14px: the refused press, and the three lines of the undo', () => {
    expect(dialogs.match(/className="mt-3 text-sm font-normal text-(danger|info)"/g)).toHaveLength(
      4,
    );
    expect(dialogs).not.toMatch(/mt-3 text-xs/);
  });
});
