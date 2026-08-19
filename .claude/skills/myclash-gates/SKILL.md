---
name: myclash-gates
description: The real verification chain for this repo — what to run before pushing, in what order, and the build-ordering traps that make a green local run lie. Use before any push or commit, when a gate goes red, when touching packages/ui or packages/rulesets or the API, and when the complexity baseline needs re-pointing.
---

# MyClash verification gates

`pnpm lint && pnpm typecheck && pnpm test` is **not** the CI check. CI's Lint job runs twenty-five
further steps — twenty-two independent gates plus three builds. Running only the three and pushing
is the most common way to turn `main` red here.

Source of truth: `.github/workflows/ci.yml`. If this file and that file disagree, the workflow wins.

## Order matters: build shared packages first

The API and the apps resolve workspace deps from `dist/index.d.ts` **on disk**, not through the
pnpm symlink. Typechecking against a stale or missing `dist/` produces either phantom errors or —
worse — phantom passes.

```bash
pnpm turbo run build --filter="@myclash/types" --filter="@myclash/rulesets" \
  --filter="@myclash/db" --filter="@myclash/ui" --filter="@myclash/i18n" --filter="@myclash/api-client"
```

- **`@myclash/rulesets` must be built before the API typechecks** (`moduleResolution: node`).
- **Rebuild `@myclash/ui` before typechecking any app**, or the app checks against old prop types
  and passes on code that will not compile in Docker.
- **The API's own typecheck must go through `nest build`.** Incremental `tsc` stale-passes: it
  trusts `.tsbuildinfo` and reports clean on code that does not compile from scratch.

## The chain

```bash
pnpm turbo run typecheck
pnpm turbo run lint
pnpm turbo run test

pnpm quality:peers               # peerDependencyRules — a non-camelCase key no-ops silently
pnpm security:client-secrets     # no server secrets reachable from client bundles
pnpm quality:todos               # untracked debt markers
pnpm quality:source-bytes        # a raw NUL makes git call the file binary — no diff, no rg hit
pnpm quality:api-docs            # API doc coverage
pnpm quality:complexity          # per-function/file line budget (see below)
pnpm quality:test-code-leak      # test code kept out of the emit surface
pnpm quality:client-env          # client env build-arg contract
pnpm --filter @myclash/api build # required: OpenAPI is emitted by booting dist/app.module
pnpm quality:openapi-drift       # generated client vs live routes
pnpm quality:shared-types        # shared-type leaks
pnpm design:lint                 # designmd's own lint of DESIGN.md
pnpm quality:design-drift        # DESIGN.md vs packages/ui/src/theme.css
pnpm db:review                   # schema/RLS review gates
pnpm db:realtime-bindings        # an unpublished table in any binding kills the channel
pnpm db:perf:fixture
pnpm infra:review
pnpm observability:review
pnpm perf:review
pnpm --filter @myclash/web-marketing build   # the bundle budgets need something to weigh
pnpm perf:bundle:build                       # …and so do the page-load budgets
pnpm perf:bundle -- --include-next --require-build   # without the flags it weighs nothing and passes
pnpm test:scripts                # root scripts/ — outside the turbo graph
pnpm docs:mermaid                # a broken diagram renders as grey text, it does not throw
pnpm format:check                # last: prettier
```

Each is an independent verdict. In CI they each carry `if: '!cancelled()'` for a reason:
they were once a single `&&` chain, and because `quality:complexity` was red on `main`,
eight gates behind it silently did not run for roughly six weeks. Never re-chain them with `&&`
locally either — you will reproduce the same blindness.

## Traps

**A red gate is not necessarily yours.** Before debugging, re-run the gate on a clean HEAD
(`git stash`). If it is red there too, it belongs to whoever introduced it — say so and move on
rather than absorbing someone else's failure into your slice.

**The complexity baseline is line-keyed.** Entries point at a file _and line_, so any edit above a
baselined function re-points it and the gate goes red on untouched code. Re-point rather than
refactor when the function itself did not change. Refresh with `--write-baseline` only when HEAD
is green and you have audited the diff — and re-run the identity check **after** committing, since
the pre-commit prettier pass shifts lines again.

**Root `tests/` gets no typecheck and no lint.** Type errors and unused imports in the E2E suite
reach `main` unnoticed; read it carefully, because neither of those will catch them.

It is **not** outside every gate, though. `scripts/lib/repo-scan.mjs` does not ignore `tests`, so
`quality:complexity`, `quality:source-bytes` and `quality:todos` all walk it — and the complexity
baseline carries 24 entries under `tests/`. Editing above one of them re-points the line-keyed
baseline exactly as it would in `apps/`, which is the paragraph above biting in a directory nobody
expects it to.

**Concurrent sessions.** More than one agent commits to this repo. `git log --oneline -1` before
staging and `git fetch` before pushing; re-run the gates after the fetch, not only before staging.

**Multi-package changes.** Never trust `pnpm --filter X typecheck` alone. A change in a shared
package surfaces in consumers only under the full turbo pipeline.

## After a fresh clone

`pnpm install` — the `prepare` script re-registers the git hooks through `simple-git-hooks`.
Without it the pre-commit format hook never fires and `format:check` fails in CI.
