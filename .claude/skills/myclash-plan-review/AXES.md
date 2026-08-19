# The six axes

Every pass returns a verdict on all six. The probes below say where to look, so the review reads
code rather than reasoning from generic defaults.

Rollback is deliberately **not** an axis. The operator wipes and redeploys the whole stack every few
commits (`CLAUDE.md`, Workflow), so most slices have no backout to describe, and an axis that never
has content breeds either ritual "clean" rows or invented findings. It survives as one probe in
axis 5, for the genuinely irreversible step.

---

## 1. Verification vacuity

The plan says a thing works. Does anything actually hold it?

- **Would the test survive deleting the code it covers?** If the answer is yes, the test is
  decorative. This is the repo's most common defect: a sweep of 504 filters found 453 held by no
  test at all.
- **Does the plan include the falsification step, and does it prove the break landed?** Seeding a
  break and watching red is only evidence if the seeded text really changed — assert that, and abort
  when the search string stops matching rather than reporting a pass.
- **Collected-count parity.** A break that stops a file from being collected reds every test in it
  and reads as a triumphant red. Compare the collected count against the baseline; a drop means the
  break was too coarse to prove anything.
- **A new gate must fail loudly on nothing.** Gates in this repo go through `defineGate` in
  [scripts/lib/gate.mjs](../../../scripts/lib/gate.mjs), which refuses a bare `scanned: 0` — a run
  that examined nothing has to say so by name through `nothingToCount(reason)`. A gate whose test
  asserts only the exit code passes green while checking nothing.
- **Run the gate directly, not through turbo.** Turbo serves a cached green from a previous input
  hash, so a red gate can look clean for as long as its inputs sit still.
- **Does the assertion name the thing?** A test over a database read must assert the SELECT string;
  mocks ignore the projection, so deleting a column leaves the test green.
- **"The file exists" is not "the command works."** Four `packages/db` script aliases were broken
  from the commit that added them until somebody ran one, because the rule covering them asserts only
  that the target file is **tracked**. The sibling test at
  [scripts/package-manifests.test.mjs:135](../../../scripts/package-manifests.test.mjs) closes that
  class. A plan whose evidence is a file's existence has no evidence.

## 2. Prerequisites and hidden dependencies

- **Build order.** Shared packages resolve from `dist/` on disk, not through the pnpm symlink.
  Rebuild `@myclash/rulesets` before the API typechecks and `@myclash/ui` before any app does, or the
  check passes on code that will not compile in Docker. Full chain in
  [../myclash-gates/SKILL.md](../myclash-gates/SKILL.md).
- **Registration completeness.** A new CI gate needs **four** registrations, per
  [scripts/package-manifests.test.mjs:12](../../../scripts/package-manifests.test.mjs): the
  `package.json` script, the step in `.github/workflows/ci.yml` carrying `if: '!cancelled()'`, an
  entry in `CI_GATES` in
  [apps/api/src/modules/admin/ci-health/gates.ts](../../../apps/api/src/modules/admin/ci-health/gates.ts)
  keyed by the step's display name, and `CONTRIBUTING.md`. The chain in
  [../myclash-gates/SKILL.md](../myclash-gates/SKILL.md) moves with `CONTRIBUTING.md`. Miss the
  `CI_GATES` one and the health card cannot report a gate that stopped running.
- **Does the gate's own test pin its registration?** The pattern is
  [scripts/check-design-drift.test.mjs:313-350](../../../scripts/check-design-drift.test.mjs): the
  pnpm script is the gate **alone**, CI runs it as its own step, neither is `&&`-chained, and
  `CI_GATES` carries the step name. A gate behind an `&&` is a gate that can silently not run — the
  shape that hid eight gates for six weeks, and it hid this one inside a single pnpm script until
  `5b5b7301` split it out.
- **A workspace script must not call `../../scripts/*.mjs`.** pnpm sets the cwd to the package while
  every root gate reads the cwd as the repo root, so the paths double and it dies with `ENOENT`.
  Declare it in the root manifest. Guarded now, so a plan proposing one goes red.
- **Anything new under `.claude/` needs a `.gitignore` negation.** `.claude/skills/*` is ignored and
  re-admitted one directory at a time. Without the line, `git status --porcelain -uall` prints
  nothing at all for the new directory and the work never leaves the machine that wrote it.
- **Owner-side prerequisites.** Any `[needs O-NNN]` in `docs/OWNER_TASKS.md` that this plan depends
  on must already be done — if not, stop and notify rather than planning around it.
- **Concurrent sessions.** Several agents commit here. Does the plan check `git log --oneline -1`
  before staging and `git fetch` before pushing, and stage explicit paths rather than `git add -A`?
- **Does the plan assume a file that a rename moved?** `infra:review` pins paths and crashes on a
  rename; the complexity baseline is line-keyed and re-points on any edit above a baselined function.

## 3. Blast radius and failure modes

- **Which gates does this turn red?** Walk the chain in `../myclash-gates/SKILL.md` and name them.
  Root `tests/` sits outside every gate except `format:check`, so type errors there reach `main`
  unnoticed.
- **What breaks for the other sessions?** A shared-package change surfaces in consumers only under
  the full turbo pipeline; `pnpm --filter X typecheck` alone proves nothing.
- **Offline scoring is non-negotiable.** Any change reaching the scoring app must keep it working
  offline, and the offline E2E tests must pass.
- **Widening a shared union.** The compile errors in consuming apps _are_ the checklist — a plan that
  adds `default:` to silence them is hiding the work it was supposed to do.
- **Renaming or splitting a `pnpm` script rots the docs, and nothing gates it.** No gate in the chain
  compares prose against `package.json` script names. Splitting `design:lint` had to correct **ten**
  documents, two of them inside `.claude/skills/`. Grep the old name repo-wide before calling a
  rename done.
- **Is a step genuinely irreversible?** Only then does a rollback path belong in the plan.

## 4. Security and access

- **Every new table needs an RLS policy.** Without one the table is world-readable: PostgREST exposes
  `public` as `anon`. RLS first, application checks second.
- **Views and functions bypass RLS.** An unpinned view runs as its `BYPASSRLS` owner, so a view over
  a protected table is a hole even when the table is policed.
- **Is an authorization sweep scoped too narrowly?** Scoping a sweep to one module hides the same
  hole in its neighbours — the referees fix left twenty routes in `matches` with identical gaps.
- **Guards that fail open.** A `@PlatformRole` on a GET is a silent no-op, and a guard resolving the
  event by a params name fails open when the route names it differently.
- **The repo is public and AGPL.** No secrets, no real rosters, no personal data — `.env.example` is
  the canonical key list.

## 5. Data integrity and migration replay

- **Numbering is max+1.** Latest is in `packages/db/migrations`; a duplicate number collides with
  whatever another session just landed.
- **DDL replay on PG17.** A CHECK drop can fail silently, so the plan needs a verification that reads
  the post-migration schema rather than trusting the migration ran.
- **Never bypass the ruleset engine.** Scores are derived from exchanges through `@myclash/rulesets`;
  a computed score stored as source of truth is a BLOCKER.
- **TF_v1 reproduces the FAL 2026 reference byte-for-byte.** If the plan changes engine behaviour,
  it must say what happens to `packages/rulesets/test/tf_v1.fal2026.test.ts` — the fixture is never
  the thing that gets fixed.
- **No `eval`, no `Function()`.** Ruleset formulas are a Zod-validated AST evaluated by our own
  interpreter. A plan that reintroduces a compiled string is a BLOCKER.

## 6. Unverified assumptions

- **Every load-bearing assumption is cited or flagged.** Either `file:line`, or listed as UNVERIFIED
  with the exact command that would settle it. "The service already handles this" without a citation
  is the shape to hunt.
- **Safety comments rot.** A declaration in a docstring — "the only copy", "always validated" — is
  evidence of intent, not of behaviour. Confirm it against the code before leaning on it.
- **i18n.** Every user-facing string resolves in both `en` and `fr`. The i18n lint reads JSX only, so
  strings in `setError` or `throw` slip past it.
- **Design tokens.** UI work uses tokens from `packages/ui/src/theme.css`, gated by
  `pnpm quality:design-drift`; raw colours are a finding.
- **Vocabulary.** Event / Tournament / Workshop / Pool / Match / Exchange carry fixed meanings in
  `docs/HIERARCHY.md`. A plan using them loosely will build the wrong thing.
