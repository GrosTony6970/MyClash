import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard for a silent NestJS DI footgun.
 *
 * These are all `@Optional()` constructor dependencies. If one is brought in
 * with a TYPE-ONLY import (`import type { X }`), the import is erased at
 * runtime, `design:paramtypes` emits `Object`, Nest cannot resolve the provider,
 * and @Optional() quietly injects `undefined`. The symptoms are invisible: every
 * match-completion side effect stops firing (MatchCompletionService), or the
 * bracket seeds from registration order while the pools-complete gate is
 * vacuously true (PhasesService.poolStandings). Both have regressed before.
 *
 * The app builds with tsc (metadata emitted) but the test runner uses esbuild
 * (no decorator metadata), so we cannot assert design:paramtypes here — guard
 * the source instead: these services must be VALUE-imported, never `import type`.
 */
const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

/**
 * Two assertions, not one. Checking only "is not `import type`" passes
 * vacuously once the import is gone altogether — so require the name to be
 * present AND to be a value import.
 */
const valueImports = (rel: string, name: string) => {
  const src = read(rel);
  expect(src, `${rel} should inject ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
  expect(src, `${name} must be a value import, not \`import type\``).not.toMatch(
    new RegExp(`import\\s+type\\s*\\{[^}]*\\b${name}\\b`),
  );
};

describe('NestJS DI wiring — injected services must be value-imported', () => {
  // The four match-completion paths all inject the single completion owner.
  for (const file of [
    './matches.service.ts',
    './match-forfeits.service.ts',
    './scoring.service.ts',
    './clock.service.ts',
  ]) {
    it(`${file} value-imports MatchCompletionService`, () =>
      valueImports(file, 'MatchCompletionService'));
  }

  it('match-completion.service value-imports its three collaborators', () => {
    valueImports('../phases/match-completion.service.ts', 'BracketAdvanceService');
    valueImports('../phases/match-completion.service.ts', 'PhasesService');
    // Swiss auto-advance. `import type` here injects undefined and every Swiss
    // round silently stops pairing itself — the same failure mode as the two
    // above, on a path where nothing else would ever notice.
    valueImports('../phases/match-completion.service.ts', 'SwissAdvanceService');
  });

  it('swiss-advance.service value-imports its two collaborators', () => {
    valueImports('../swiss/swiss-advance.service.ts', 'SwissPairingService');
    valueImports('../swiss/swiss-advance.service.ts', 'SwissRoundStateService');
  });

  it('phases.service value-imports PoolStandingsService + BracketAdvanceService', () => {
    valueImports('../phases/phases.service.ts', 'PoolStandingsService');
    valueImports('../phases/phases.service.ts', 'BracketAdvanceService');
  });

  // A result override reaches BracketAdvanceService twice: to refuse the write
  // once a dependent match has started, and to clear the downstream slot sides
  // so re-advancement is not a silent no-op. Both are `this.bracketAdvance?.`
  // calls on an @Optional() dep, so `import type` here does not fail — it
  // disarms the guard AND leaves the bracket carrying the previous winner,
  // with no error anywhere. Exactly the shape of the two regressions above.
  it('match-forfeits.service value-imports BracketAdvanceService', () => {
    valueImports('./match-forfeits.service.ts', 'BracketAdvanceService');
  });
});

/**
 * Every path that completes a match must hand off to MatchCompletionService.
 *
 * A completed match owes two side effects — advance the bracket, and (for a pool
 * match) try to auto-populate the bracket now the pools may be done. Wiring them
 * per call site went wrong twice, silently, because a missing call looks like
 * nothing at all:
 *   1. advancement was wired only to `PATCH /matches/:id/status` and forfeits.
 *      The pad calls neither — it posts exchanges and drives the clock — so a
 *      bracket scored on the pad never advanced its winner.
 *   2. once that was fixed, the auto-populate call sitting on the very next line
 *      was still missed, so scoring the last pool match on the pad left the
 *      bracket empty.
 *
 * Both are the same defect: side effects owned by call sites rather than by the
 * event. There is now exactly ONE thing to call, and this guard asserts each
 * path calls it — so adding a fifth completion path fails here rather than in
 * production six months later.
 *
 * Asserted against source text because these are `void`/`await` calls on an
 * @Optional() dependency: there is no type-level signal, and a missing call is
 * silent by construction.
 */
describe('every match-completion path hands off to MatchCompletionService', () => {
  const completesAndHandsOff = (rel: string, label: string) => {
    const src = read(rel);
    // Non-vacuity: this file really is a completion path. Assignment styles
    // differ (`status: 'completed'` vs `updates['status'] = dto.status`), so
    // match the literal rather than one spelling of the write.
    expect(src, `${label} should reference match completion`).toMatch(/'completed'/);
    expect(src, `${label} must call matchCompletion.onMatchCompleted`).toMatch(
      /matchCompletion\??\.\s*onMatchCompleted/,
    );
  };

  it('matches.service (PATCH /status)', () =>
    completesAndHandsOff('./matches.service.ts', 'updateStatus'));
  it('match-forfeits.service (forfeit)', () =>
    completesAndHandsOff('./match-forfeits.service.ts', 'forfeit'));
  it('scoring.service (point cap / double cap)', () =>
    completesAndHandsOff('./scoring.service.ts', 'scoring auto-complete'));
  it('clock.service (clock end)', () => completesAndHandsOff('./clock.service.ts', 'clock end'));
});
// The other half — that the single owner actually PERFORMS both side effects —
// is asserted behaviourally in ../phases/match-completion.service.test.ts.
// A source-text guard was tried here first and was vacuous: the word
// `populateBracket` still matched the docstring and the private method's own
// name after the call itself had been deleted.
