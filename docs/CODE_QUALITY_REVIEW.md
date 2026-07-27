# Code Quality Review

Phase 3 production-readiness review, last updated 2026-05-12.

## Status

**Pass with known issues.** The remaining issues are documented complexity hotspots accepted for v1, guarded by a committed baseline so new unreviewed hotspots fail CI.

## Enforced Gates

- `pnpm quality:todos` fails on `TODO` or `FIXME` unless the line includes an explicit task/reference marker: `T-####`, `O-####`, `BUILD_ORDER`, `OWNER_TASKS`, `docs/pre-production-review-plan.md`, or a GitHub issue URL.
- `pnpm quality:api-docs` fails when an API controller is missing `@ApiTags` or an HTTP route is missing `@ApiOperation`.
- `pnpm quality:complexity` fails when a file over 400 lines or function over 50 lines appears outside `docs/code-quality-complexity-baseline.json`. Functions are found with the TypeScript parser (`scripts/check-complexity.mjs`), and the script has its own tests (`scripts/check-complexity.test.mjs`) — see the note below for why.
- `pnpm quality:shared-types` fails on explicit `any` in shared packages and API production code, excluding tests, generated files, and legitimate string literals such as query enums.

These gates run in CI after lint, **one step per gate**. They were a single `&&` chain until 2026-07-27, which meant the first failure hid every gate behind it — `quality:complexity` had been red on `main` since at least 2026-06-16, so `quality:shared-types`, `design:lint`, `db:review`, `db:perf:fixture`, `infra:review`, `observability:review`, `perf:review` and `format:check` had been _skipped_ rather than passing for roughly six weeks. Each gate step now carries `if: '!cancelled()'` so one red gate reports alongside the others instead of masking them.

### Why the complexity gate parses instead of counting braces

It originally detected functions with a regex plus a running brace count over raw text, which counted braces inside strings, comments, template literals, regex literals and JSX. A single `}` in a string closed the frame early, the measured length collapsed under the limit, and the function vanished from the report — a **false negative**, the worst failure mode a gate has.

When this was replaced on 2026-07-27, 135 long functions became visible for the first time, including `ScheduleView` (500 lines), `StatsView` (373), `TournamentPage` (362), `EventsService.listPublicParticipants` (342) and `PhasesService.populateBracket` (314).

Truly anonymous inline callbacks (`.map(x => …)`, `useMemo(() => …)`) are deliberately not reported on their own: their lines already count towards the named function containing them.

### Working with the baseline

The baseline is a review ledger keyed on `path:line`, so **it drifts whenever code moves**. Inserting six lines at the top of a file re-flags every entry below it, unchanged. When that happens, re-point the moved entries rather than regenerating.

`--write-baseline` rewrites the whole ledger and will silently absorb genuinely unreviewed hotspots along with the re-points. Reach for it only when the detector itself changed (every id moves by construction); otherwise merge just your own delta, which you can compute by running the gate on a clean checkout and diffing against your branch.

Known gap: the ledger records no size, so a reviewed 51-line function can grow to 500 and stay green. Making entries carry a line budget — a real ratchet — is the remaining piece of this work.

## API Error Contract

The API uses a global NestJS exception filter. Non-2xx responses return this envelope:

```ts
{
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  path: string;
  method: string;
  timestamp: string;
  requestId?: string;
}
```

Status codes are preserved from thrown `HttpException` instances. Structured payloads such as confirmation conflicts and spend-cap metadata are preserved in `details`. Unknown errors return a generic internal error in production-style responses and do not expose stack traces.

## Process Failures

The API bootstrap registers process-level handlers for:

- `unhandledRejection`: logged with reason and stack when available.
- `uncaughtException`: logged, then the process exits with code 1.

The formatting/logging helpers have unit tests; tests do not intentionally crash the process.

## TODO/FIXME Policy

Open TODO/FIXME comments must reference a tracked task or owner action. Current intentional references are tied to:

- `T-003b`: marketing package no-op scripts until the static marketing site grows real checks.
- `T-105`: dashboard feature expansion.
- `T-608`: public schedule match timing enrichment.

Prompt history is excluded from this gate because it is an append-only raw instruction log.

## Complexity Hotspots

Baseline: `docs/code-quality-complexity-baseline.json`

Current baseline (regenerated 2026-07-27 when the detector was replaced):

- 171 files over 400 lines.
- 666 functions over 50 lines.

The jump from the previously recorded 54 / 153 is not new debt. It is the same code, finally measured: the old brace-counting detector under-reported, and the older figures in this document had also fallen out of date with the ledger.

Owner: project owner / technical maintainer.

Risk: accepted for v1 because the hotspots are existing implementation and test files, mostly in event administration, scoring, phase generation, AI assistants, and import workflows. The gate prevents silent growth. Modules touched for new feature work should split large functions/files when that work naturally crosses the hotspot boundary.

Launch decision: not a blocker for first production deploy while the baseline gate is active and all critical CI gates pass.
