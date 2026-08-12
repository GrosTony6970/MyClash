import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
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

  // The results freeze is the only thing stopping an override rewriting a
  // completed event's results outside the exchange-edit review. `import type`
  // here makes `this.frozenResults?.` a no-op on undefined — the check does not
  // fail, it just stops existing, which is the worst shape a guard can take.
  it('match-forfeits.service value-imports FrozenResultsGuard', () => {
    valueImports('./match-forfeits.service.ts', 'FrozenResultsGuard');
  });
});

/**
 * The provider has to be REACHABLE, not just imported.
 *
 * FrozenResultsGuard moved out of MatchesModule's `providers` into its own leaf
 * so a phase-side owner can inject it without closing
 * PhasesModule → MatchesModule → PhasesModule. That move silently changes what
 * every consumer module can see: a module that injects the guard but does not
 * import the leaf gets `undefined` from @Optional() and the freeze stops
 * existing — the same failure the value-import guards above exist to catch, one
 * layer out.
 *
 * Nest throws for the one NON-optional consumer
 * (`exchange-edit-requests.service.ts`), but only at real boot. No TEST boots the
 * container — `pnpm quality:openapi-drift` does, via emit-openapi.cjs on the
 * built dist, which is where this failure actually surfaced. That is a slow gate
 * that needs `nest build` first, and it says nothing at all about the other three
 * consumers, which are @Optional() and would never throw. So assert the module
 * edge in source, where it is cheap and covers every consumer.
 */
describe('every module injecting FrozenResultsGuard imports the leaf that provides it', () => {
  /**
   * Derived, not listed. A hand-written service→module table was the first cut
   * and it was wrong on its first outing: `ExchangeEditRequestsAdminService` is
   * registered in BOTH AdminModule and ReviewQueueModule, the table named only
   * the first, and Nest resolves per REGISTERING MODULE rather than per class —
   * so the second one threw at boot with the guard's own test green.
   *
   * Scanning for the registrations cannot make that mistake: whichever modules
   * list a consumer in `providers:`, all of them must import the leaf.
   */
  const apiSrc = join(__dirname, '..', '..');

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith('.module.ts') ? [full] : [];
    });

  const CONSUMER_SERVICES = [
    'MatchesService',
    'MatchForfeitsService',
    'PenaltiesService',
    'ExchangeEditRequestsAdminService',
    'MatchCompletionService',
  ];

  const moduleFiles = walk(apiSrc);

  it('finds the module files at all — a broken scan must not read as a clean repo', () => {
    expect(moduleFiles.length).toBeGreaterThan(20);
  });

  for (const serviceName of CONSUMER_SERVICES) {
    it(`${serviceName}: every module registering it imports FrozenResultsModule`, () => {
      const registering = moduleFiles.filter((file) => {
        const src = readFileSync(file, 'utf8');
        const providers = src.slice(src.indexOf('providers:'));
        return src.includes('providers:') && providers.includes(serviceName);
      });
      expect(registering.length, `no module registers ${serviceName}`).toBeGreaterThan(0);

      for (const file of registering) {
        expect(
          readFileSync(file, 'utf8'),
          `${file} registers ${serviceName}, which injects FrozenResultsGuard, so it must import FrozenResultsModule`,
        ).toMatch(/\bFrozenResultsModule\b/);
      }
    });
  }

  const CONSUMERS: Array<[serviceFile: string, moduleFile: string]> = [
    ['./matches.service.ts', './matches.module.ts'],
    ['./match-forfeits.service.ts', './matches.module.ts'],
    ['../penalties/penalties.service.ts', '../penalties/penalties.module.ts'],
    ['../admin/exchange-edit-requests.service.ts', '../admin/admin.module.ts'],
    ['../admin/exchange-edit-requests.service.ts', '../admin/review-queue.module.ts'],
    ['../phases/match-completion.service.ts', '../phases/phases.module.ts'],
  ];

  /**
   * The `imports:` array, not the whole file. An `import { X } from …` statement
   * at the top satisfies a bare file-wide match while the module still does not
   * import X — which is exactly how a first cut of this guard passed its own
   * falsification.
   */
  const importsArrayOf = (moduleFile: string): string => {
    const src = read(moduleFile);
    const start = src.indexOf('imports:');
    expect(start, `${moduleFile} has no imports: array`).toBeGreaterThan(-1);
    const open = src.indexOf('[', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '[') depth++;
      if (src[i] === ']' && --depth === 0) return src.slice(open, i + 1);
    }
    throw new Error(`${moduleFile}: unterminated imports: array`);
  };

  for (const [serviceFile, moduleFile] of CONSUMERS) {
    it(`${serviceFile} → ${moduleFile}`, () => {
      // Non-vacuity: this service really does inject the guard.
      expect(read(serviceFile), `${serviceFile} should inject FrozenResultsGuard`).toMatch(
        /\bFrozenResultsGuard\b/,
      );
      expect(
        importsArrayOf(moduleFile),
        `${moduleFile} must list FrozenResultsModule in imports: — its provider is no longer in MatchesModule`,
      ).toMatch(/\bFrozenResultsModule\b/);
    });
  }

  // The other half: nothing may quietly put the provider back where it was, or
  // the leaf stops being the single owner and the cycle becomes reachable again.
  it('MatchesModule no longer provides the guard itself', () => {
    const src = read('./matches.module.ts');
    expect(src).toMatch(/\bFrozenResultsModule\b/);
    expect(src, 'FrozenResultsGuard must come from the leaf, not from providers[]').not.toMatch(
      /\bFrozenResultsGuard\b/,
    );
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

/**
 * And every path that takes one BACK OUT hands off to the same owner.
 *
 * The mirror of the guard above, for the same reason: the call is
 * `await this.matchCompletion?.onMatchUncompleted(...)` on an @Optional()
 * dependency, so a missing one is silent by construction — the bracket simply
 * keeps naming a fighter who did not win, for the rest of the event.
 *
 * The census is three files, not one route. `clock.service.ts` is here because
 * its transition table is keyed on the clock status replayed from match_events
 * and never reads `matches.status`, so 'start', 'halt' and 'resume' are legal on
 * a completed bout whose clock never ran — 'reopen' is not the only clock action
 * that un-completes.
 *
 * Matched with the open paren: this file already records a source-text guard
 * going vacuous against a docstring that still contained the bare name.
 */
describe('every path that un-completes a match hands off to MatchCompletionService', () => {
  const uncompletesAndHandsOff = (rel: string, label: string) => {
    const src = read(rel);
    expect(src, `${label} must call matchCompletion.onMatchUncompleted(`).toMatch(
      /matchCompletion\??\.\s*onMatchUncompleted\(/,
    );
  };

  it('matches.service (reset, PATCH /status, void)', () =>
    uncompletesAndHandsOff('./matches.service.ts', 'resetMatch / setStatus'));
  it('clock.service (reopen, and the three siblings that also write a status)', () =>
    uncompletesAndHandsOff('./clock.service.ts', 'clockAction'));
});

// The other half — that the single owner actually PERFORMS both side effects —
// is asserted behaviourally in ../phases/match-completion.service.test.ts.
// A source-text guard was tried here first and was vacuous: the word
// `populateBracket` still matched the docstring and the private method's own
// name after the call itself had been deleted.
