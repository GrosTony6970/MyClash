# Code Quality Review

Phase 3 production-readiness review, last updated 2026-05-12.

## Status

**Pass with known issues.** The remaining issues are documented complexity hotspots accepted for v1, guarded by a committed baseline so new unreviewed hotspots fail CI.

## Enforced Gates

- `pnpm quality:todos` fails on `TODO` or `FIXME` unless the line includes an explicit task/reference marker: `T-####`, `O-####`, `BUILD_ORDER`, `OWNER_TASKS`, `docs/pre-production-review-plan.md`, or a GitHub issue URL.
- `pnpm quality:api-docs` fails when an API controller is missing `@ApiTags` or an HTTP route is missing `@ApiOperation`.
- `pnpm quality:complexity` fails when a file over 400 lines or function over 50 lines appears outside `docs/code-quality-complexity-baseline.json`.
- `pnpm quality:shared-types` fails on explicit `any` in shared packages and API production code, excluding tests, generated files, and legitimate string literals such as query enums.

These gates run in CI after lint.

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

Current baseline:

- 54 files over 400 lines.
- 153 functions over 50 lines.

Owner: project owner / technical maintainer.

Risk: accepted for v1 because the hotspots are existing implementation and test files, mostly in event administration, scoring, phase generation, AI assistants, and import workflows. The gate prevents silent growth. Modules touched for new feature work should split large functions/files when that work naturally crosses the hotspot boundary.

Launch decision: not a blocker for first production deploy while the baseline gate is active and all critical CI gates pass.
