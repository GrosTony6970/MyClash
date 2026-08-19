# tests/

Top-level cross-app test suites that don't belong to any single workspace.

| Subdirectory | Purpose                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/`       | Playwright end-to-end tests spanning multiple apps (organizer creates a tournament → competitor onboards → scorekeeper records exchanges → public app shows live results). 36 specs, most opt-in — see [`e2e/README.md`](e2e/README.md)  |
| `a11y/`      | Axe accessibility audits on critical user flows                                                                                                                                                                                          |
| `perf/`      | Playwright page-load budgets (`web-public.spec.ts`). Measures the page, which is a different number from the root-shell bundle budget in `scripts/check-bundle-budgets.mjs` — the two are disjoint and neither substitutes for the other |
| `drag/`      | Drag-and-drop coverage for the schedule grid, which Playwright's `dragTo` hangs on. `schedule-grid.harness.ts` drives the pointer events by hand; the spec needs Supabase env to run                                                     |

Per-package unit tests live in their respective workspace — `packages/rulesets/test/`, and for the
API **colocated** as `apps/api/src/**/*.test.ts`, which is what its vitest `include` accepts. The
empty `apps/api/test/` directory is vestigial. Use this directory only for tests that span workspace
boundaries.

Counts are deliberately not restated here. `git ls-files 'apps/api/src/**/*.test.ts' | wc -l` is the
answer, and it moves every few commits; the version of this file that hard-coded it drifted to 301
against a real 339, while `apps/api/tsconfig.json` carried a third number.
