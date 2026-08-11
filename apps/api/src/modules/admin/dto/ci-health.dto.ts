/**
 * Which quality gates ran on the last CI run, and which never reported.
 *
 * The second half is the one that matters. An `&&` chain in the lint job once
 * masked eight gates for roughly six weeks: a failed step skipped the rest, so
 * they were not passing, they simply never ran. Every gate step now carries
 * `if: '!cancelled()'`, which means the honest failure mode changed shape —
 * a gate that stops running today usually produces NO row at all rather than a
 * `skipped` one. `not_reported` is therefore the load-bearing verdict here, and
 * it can only be computed against an expectation held outside CI (`CI_GATES`).
 */

/**
 * A gate's outcome on the sampled run.
 *
 * `not_reported` means CI_GATES expected this gate and the run said nothing
 * about it — the step was removed, renamed, or its whole job never started.
 * `skipped` is GitHub's own conclusion and stays distinct: it means the step
 * existed and its `if:` evaluated false.
 */
export type CiGateVerdict = 'passed' | 'failed' | 'skipped' | 'cancelled' | 'not_reported';

export interface CiGateRowDto {
  job: string;
  step: string;
  verdict: CiGateVerdict;
}

/** A CI run, as the card identifies it. */
export interface CiRunDto {
  runNumber: number;
  sha: string;
  /** GitHub's run conclusion: success, failure, cancelled, … */
  conclusion: string | null;
  createdAt: string;
  url: string;
}

export interface CiHealthResponseDto {
  /**
   * `unavailable` when GitHub could not be reached or answered badly. The card
   * renders the reason rather than an empty table, matching host-info and the
   * four runtime-health collectors.
   */
  status: 'ok' | 'unavailable';
  checkedAt: string;
  /** `owner/name`, so the card can say which repo it is reporting on. */
  repo: string;
  /** The most recent CI run on the default branch. Null when unavailable. */
  latestRun: CiRunDto | null;
  /**
   * The most recent run where EVERY job was green.
   *
   * Expect this to be old, and show its age rather than hiding it: on a repo
   * where one job stays red for months, "last all-green" is months behind HEAD
   * and says nothing about whether Lint passed this morning. Its staleness is
   * the honest signal, which is why the per-gate table above it is the primary
   * reading and this is context.
   */
  lastAllGreenRun: CiRunDto | null;
  /** One row per gate in CI_GATES, in workflow order. */
  gates: CiGateRowDto[];
  /** Gates the run never reported on — the masking detector. Subset of `gates`. */
  notReportedCount: number;
  /** Remaining GitHub API budget, so the operator can see the cap approaching. */
  rateLimitRemaining: number | null;
  /** Whether a GITHUB_TOKEN was configured (60/h unauthenticated vs 5000/h). */
  authenticated: boolean;
  /** Why the answer is unavailable. Present only when `status === 'unavailable'`. */
  error?: string;
}
