/**
 * What counts as a gate in `.github/workflows/ci.yml`, as a constant this process
 * can carry into production.
 *
 * The API image ships built JavaScript, not the repo — there is no `.github/`
 * inside the container — so the expected gate list cannot be read from the
 * workflow at runtime. It lives here instead, and `gates.drift.test.ts` asserts
 * both directions against the real file: a renamed gate fails, and a NEW step
 * that is neither listed here nor bucketed as plumbing fails. That is the same
 * "bucket it consciously" shape as `archive.migration-coverage.test.ts`.
 *
 * WHY A CONSTANT IS THE POINT, not a workaround. The card's job is to catch a
 * gate that did not run. A gate that vanished from CI reports nothing at all —
 * there is no row with `conclusion: 'skipped'`, there is simply no row. Only an
 * independently-held expectation can name what is missing, so comparing CI's
 * answer against a list derived from CI would detect exactly nothing. This is
 * the failure the `&&` chain produced for six weeks.
 */

/** One CI gate: the job that runs it and the step name GitHub reports. */
export interface CiGate {
  /** `jobs.<key>.name` in ci.yml. */
  job: string;
  /** The step's `name:` — matched exactly against `steps[].name`. */
  step: string;
  /**
   * True when the job runs under `strategy.matrix`.
   *
   * A matrix job's declared name is NOT the name the API reports: GitHub appends
   * the expanded values, so `Trivy production image scan` comes back four times
   * as `Trivy production image scan (myclash-api, apps/api/Dockerfile)` and so on.
   * Matching those by equality reports every leg as `not_reported` — a false
   * alarm on the card's loudest signal. Found by running the join against the
   * live API; unit tests that build jobs from this list agree with it by
   * construction and cannot catch it.
   */
  matrix?: true;
}

/**
 * Every step that constitutes a quality gate, in workflow order.
 *
 * Excludes setup and plumbing (see CI_PLUMBING_STEPS). A step belongs here when
 * its failure means the code is wrong, not that the runner had a bad day.
 */
export const CI_GATES: readonly CiGate[] = [
  { job: 'Typecheck', step: 'Typecheck all workspaces' },

  { job: 'Lint', step: 'Lint all workspaces' },
  { job: 'Lint', step: 'Check peer dependencies' },
  { job: 'Lint', step: 'Check frontend secret boundaries' },
  { job: 'Lint', step: 'Check untracked debt markers' },
  { job: 'Lint', step: 'Check API docs coverage' },
  { job: 'Lint', step: 'Check code complexity budget' },
  { job: 'Lint', step: 'Check test code is out of the emit surface' },
  { job: 'Lint', step: 'Check client env contract' },
  { job: 'Lint', step: 'Check OpenAPI client drift' },
  { job: 'Lint', step: 'Check shared-type leaks' },
  { job: 'Lint', step: 'Check design system drift' },
  { job: 'Lint', step: 'Check database review gates' },
  { job: 'Lint', step: 'Check realtime bindings are published' },
  { job: 'Lint', step: 'Check database perf fixture' },
  { job: 'Lint', step: 'Check infrastructure review gates' },
  { job: 'Lint', step: 'Check observability review gates' },
  { job: 'Lint', step: 'Check performance review gates' },
  { job: 'Lint', step: 'Test repo scripts' },
  { job: 'Lint', step: 'Check docs diagrams parse' },
  { job: 'Lint', step: 'Check formatting' },

  { job: 'Test', step: 'Run tests' },
  { job: 'Coverage', step: 'Run enforced coverage' },
  { job: 'Dependency audit', step: 'Audit high and critical vulnerabilities' },
  { job: 'Playwright and Axe', step: 'Run Playwright and Axe tests' },
  { job: 'Shellcheck infra scripts', step: 'Run shellcheck' },
  { job: 'Secret scan', step: 'Run Gitleaks' },
  { job: 'Trivy production image scan', step: 'Scan production image', matrix: true },
] as const;

/**
 * Named steps that are NOT gates: caches, artifacts, and the builds that exist
 * only to feed a gate. Listed rather than pattern-matched, because the patterns
 * lie — `pnpm/action-setup` is not under `actions/`, and `Post Scan production
 * image` is not `Post Run *`. A deny-list of shapes left 34 of 71 rows as noise.
 *
 * `Build API for OpenAPI emit` and `Build production image` sit here on purpose:
 * each is setup for the gate on the next line, and surfacing both halves would
 * report one gate twice.
 */
export const CI_PLUMBING_STEPS: readonly string[] = [
  'Install',
  'Cache node_modules',
  'Restore node_modules',
  'Restore Turborepo cache',
  'Save Turborepo cache',
  'Build packages',
  'Upload package dist artifacts',
  'Download package dist',
  'Build API for OpenAPI emit',
  'Upload coverage',
  'Install Playwright browser',
  'Upload Playwright report',
  'Build production image',
] as const;

/** Stable key for a gate, used to join the expectation against CI's answer. */
export function gateKey(gate: CiGate): string {
  return `${gate.job} / ${gate.step}`;
}
