/**
 * A deliberately small reader for `.github/workflows/ci.yml`.
 *
 * Test-only: nothing in the running API parses the workflow (the container has
 * no `.github/`). It exists so `gates.drift.test.ts` can hold `gates.ts` to the
 * real file.
 *
 * Line-based rather than a YAML parse, because the repo has no yaml dependency
 * and the two existing readers of this file (`scripts/check-observability-review.mjs`,
 * `scripts/check-performance-review.mjs`) read it as text too. Adding a parser
 * dependency to ship one test is not worth it.
 *
 * THE FLOOR IN THE TEST IS LOAD-BEARING. A line parser that stopped understanding
 * the file would report zero steps, and "no steps found" would otherwise read as
 * "nothing drifted" — the same trap `db-schema-conformance.test.ts` guards with
 * MIN_CHAINS.
 */

export interface WorkflowStep {
  /** `jobs.<key>.name`, falling back to the job key when it has no name. */
  job: string;
  /** The step's `name:` value. Steps without one are skipped — they are actions. */
  step: string;
}

/** Indentation of `jobs.<key>:` — two spaces under the top-level `jobs:` key. */
const JOB_KEY = /^ {2}([A-Za-z0-9_-]+):\s*$/;
/** `    name: Lint` — the job's display name, four spaces in. */
const JOB_NAME = /^ {4}name:\s*(.+?)\s*$/;
/** `      - name: Check formatting` — a step, six spaces in. */
const STEP_NAME = /^ {6}- name:\s*(.+?)\s*$/;

function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/u.exec(value);
  return quoted ? quoted[2]! : value;
}

/**
 * Every named step in the workflow, tagged with its job's display name.
 *
 * Order is preserved so a caller can present gates in the order CI runs them.
 */
export function parseWorkflowSteps(yaml: string): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  const lines = yaml.split(/\r?\n/u);

  let jobKey: string | null = null;
  let jobName: string | null = null;
  /** A job's `name:` and a step's `name:` differ only by indentation, and the
   *  job's always precedes its `steps:`. Once a step is seen, later four-space
   *  `name:` lines cannot belong to this job's header. */
  let seenStep = false;

  for (const line of lines) {
    const job = JOB_KEY.exec(line);
    if (job) {
      jobKey = job[1]!;
      jobName = null;
      seenStep = false;
      continue;
    }

    if (jobKey && !seenStep) {
      const named = JOB_NAME.exec(line);
      if (named) {
        jobName = unquote(named[1]!);
        continue;
      }
    }

    const step = STEP_NAME.exec(line);
    if (step && jobKey) {
      seenStep = true;
      steps.push({ job: jobName ?? jobKey, step: unquote(step[1]!) });
    }
  }

  return steps;
}
