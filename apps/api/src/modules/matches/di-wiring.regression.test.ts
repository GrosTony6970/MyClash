import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard for a silent NestJS DI footgun.
 *
 * MatchesService.phases / .bracketAdvance and PhasesService.poolStandings /
 * .bracketAdvance are `@Optional()` constructor dependencies. If they are
 * brought in with a TYPE-ONLY import (`import type { X }`), the import is erased
 * at runtime, `design:paramtypes` emits `Object`, Nest cannot resolve the
 * provider, and @Optional() quietly injects `undefined`. The symptoms are
 * invisible: bracket auto-populate never fires (MatchesService.phases), and the
 * bracket seeds from registration order while the pools-complete gate is
 * vacuously true (PhasesService.poolStandings). See commit history.
 *
 * The app builds with tsc (metadata emitted) but the test runner uses esbuild
 * (no decorator metadata), so we cannot assert design:paramtypes here — guard
 * the source instead: these services must be VALUE-imported, never `import type`.
 */
const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

const notTypeOnly = (src: string, name: string) =>
  expect(src, `${name} must be a value import, not \`import type\``).not.toMatch(
    new RegExp(`import\\s+type\\s*\\{[^}]*\\b${name}\\b`),
  );

describe('NestJS DI wiring — injected services must be value-imported', () => {
  it('matches.service value-imports PhasesService + BracketAdvanceService', () => {
    const src = read('./matches.service.ts');
    notTypeOnly(src, 'PhasesService');
    notTypeOnly(src, 'BracketAdvanceService');
  });

  it('phases.service value-imports PoolStandingsService + BracketAdvanceService', () => {
    const src = read('../phases/phases.service.ts');
    notTypeOnly(src, 'PoolStandingsService');
    notTypeOnly(src, 'BracketAdvanceService');
  });

  it('match-forfeits.service value-imports BracketAdvanceService', () => {
    // Regressed once: `import type` here made applyBracketForfeit's
    // `this.bracketAdvance?.onMatchCompleted(...)` a silent no-op — forfeit
    // winners were never advanced to the next bracket slot.
    const src = read('./match-forfeits.service.ts');
    notTypeOnly(src, 'BracketAdvanceService');
  });

  it('scoring.service value-imports BracketAdvanceService', () => {
    const src = read('./scoring.service.ts');
    notTypeOnly(src, 'BracketAdvanceService');
  });

  it('clock.service value-imports BracketAdvanceService', () => {
    const src = read('./clock.service.ts');
    notTypeOnly(src, 'BracketAdvanceService');
  });
});

/**
 * Every path that completes a match must advance the bracket.
 *
 * This was violated for both paths a real scorekeeper uses. The pad never calls
 * `PATCH /matches/:id/status` — it posts exchanges and drives the clock — so a
 * bracket match that hit the point cap, or whose clock was ended, completed
 * without ever advancing its winner. The only wired paths were that endpoint
 * (used exclusively by the e2e specs) and forfeits, which is why nothing caught
 * it: no bracket had yet been played through the pad.
 *
 * Asserted against source text because these are `void`/`await` calls on an
 * @Optional() dependency — there is no type-level signal, and a missing call is
 * silent by construction.
 */
describe('every match-completion path advances the bracket', () => {
  const completesAndAdvances = (rel: string, label: string) => {
    const src = read(rel);
    // Non-vacuity: this file really is a completion path. Assignment styles
    // differ (`status: 'completed'` vs `updates['status'] = dto.status`), so
    // match the literal rather than one spelling of the write.
    expect(src, `${label} should reference match completion`).toMatch(/'completed'/);
    expect(src, `${label} must call onMatchCompleted after completing a match`).toMatch(
      /bracketAdvance\??\.\s*onMatchCompleted/,
    );
  };

  it('matches.service (PATCH /status)', () =>
    completesAndAdvances('./matches.service.ts', 'updateStatus'));
  it('match-forfeits.service (forfeit)', () =>
    completesAndAdvances('./match-forfeits.service.ts', 'forfeit'));
  it('scoring.service (point cap / double cap)', () =>
    completesAndAdvances('./scoring.service.ts', 'scoring auto-complete'));
  it('clock.service (clock end)', () => completesAndAdvances('./clock.service.ts', 'clock end'));
});
