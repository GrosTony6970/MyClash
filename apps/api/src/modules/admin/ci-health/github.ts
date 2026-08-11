/**
 * The three GitHub REST reads the gate-health card needs, and nothing else.
 *
 * Unauthenticated works because the repo is public, at 60 requests/hour per IP.
 * Three calls behind a 10-minute cache is 18/h, which leaves headroom on a host
 * that shares its IP. `GITHUB_TOKEN` raises the ceiling to 5000/h and is
 * optional everywhere — absent is a supported configuration, not a degraded one.
 *
 * Every function here throws on failure. The service above catches and converts
 * to `status: 'unavailable'`; keeping the throw here means a partial answer can
 * never be mistaken for a complete one.
 */

const GITHUB_API = 'https://api.github.com';
/** GitHub hangs a slow request rather than refusing it; the card must not. */
const REQUEST_TIMEOUT_MS = 8000;

export interface GithubRun {
  id: number;
  runNumber: number;
  sha: string;
  conclusion: string | null;
  createdAt: string;
  url: string;
}

export interface GithubStep {
  name: string;
  conclusion: string | null;
}

export interface GithubJob {
  name: string;
  conclusion: string | null;
  steps: GithubStep[];
}

/** What a fetch round-trip told us, including the budget header. */
export interface GithubReply<T> {
  data: T;
  rateLimitRemaining: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseRun(raw: unknown): GithubRun | null {
  const record = asRecord(raw);
  const sha = str(record['head_sha']);
  const createdAt = str(record['created_at']);
  if (typeof record['id'] !== 'number' || !sha || !createdAt) return null;
  return {
    id: record['id'],
    runNumber: typeof record['run_number'] === 'number' ? record['run_number'] : 0,
    sha,
    conclusion: str(record['conclusion']),
    createdAt,
    url: str(record['html_url']) ?? '',
  };
}

function parseJob(raw: unknown): GithubJob | null {
  const record = asRecord(raw);
  const name = str(record['name']);
  if (!name) return null;
  const rawSteps = Array.isArray(record['steps']) ? record['steps'] : [];
  const steps: GithubStep[] = [];
  for (const rawStep of rawSteps) {
    const step = asRecord(rawStep);
    const stepName = str(step['name']);
    if (stepName) steps.push({ name: stepName, conclusion: str(step['conclusion']) });
  }
  return { name, conclusion: str(record['conclusion']), steps };
}

/**
 * Why GitHub refused.
 *
 * A 403 with the budget at zero is the one failure the operator can actually
 * act on, so it says what to do rather than reporting a bare status code.
 */
function refusalFor(status: number, rateLimitRemaining: number | null): Error {
  const exhausted = status === 403 && rateLimitRemaining === 0;
  return new Error(
    exhausted
      ? 'GitHub API rate limit exhausted; set GITHUB_TOKEN to raise it'
      : `GitHub answered ${status}`,
  );
}

export class GithubClient {
  constructor(
    private readonly repo: string,
    private readonly token: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** One round-trip, with the timeout attached and network faults renamed. */
  private async send(requestPath: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await this.fetchImpl(`${GITHUB_API}${requestPath}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(
        error instanceof Error && error.name === 'AbortError'
          ? 'GitHub did not answer within 8s'
          : 'GitHub could not be reached',
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(requestPath: string): Promise<GithubReply<T>> {
    const response = await this.send(requestPath);

    const remainingHeader = response.headers.get('x-ratelimit-remaining');
    const rateLimitRemaining = remainingHeader === null ? null : Number(remainingHeader);

    if (!response.ok) throw refusalFor(response.status, rateLimitRemaining);

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error('GitHub returned a body that is not JSON', { cause: error });
    }

    return {
      data: body as T,
      rateLimitRemaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : null,
    };
  }

  /** The most recent CI run on `branch`, or null when the workflow never ran. */
  async latestRun(branch: string): Promise<GithubReply<GithubRun | null>> {
    const reply = await this.get<unknown>(
      `/repos/${this.repo}/actions/workflows/ci.yml/runs` +
        `?branch=${encodeURIComponent(branch)}&per_page=1`,
    );
    const runs = asRecord(reply.data)['workflow_runs'];
    const first = Array.isArray(runs) ? runs[0] : null;
    return { data: first ? parseRun(first) : null, rateLimitRemaining: reply.rateLimitRemaining };
  }

  /** The most recent run on `branch` where every job was green. Often very old. */
  async lastAllGreenRun(branch: string): Promise<GithubReply<GithubRun | null>> {
    const reply = await this.get<unknown>(
      `/repos/${this.repo}/actions/workflows/ci.yml/runs` +
        `?branch=${encodeURIComponent(branch)}&status=success&per_page=1`,
    );
    const runs = asRecord(reply.data)['workflow_runs'];
    const first = Array.isArray(runs) ? runs[0] : null;
    return { data: first ? parseRun(first) : null, rateLimitRemaining: reply.rateLimitRemaining };
  }

  /**
   * Every job of a run, with its steps.
   *
   * `per_page=50` covers the 14 jobs this workflow produces with room for the
   * matrix legs to grow; pagination is deliberately not implemented, because a
   * silently truncated job list would manufacture `not_reported` rows that are
   * the card's most alarming signal. The service asserts the count instead.
   */
  async jobsForRun(runId: number): Promise<GithubReply<GithubJob[]>> {
    const reply = await this.get<unknown>(
      `/repos/${this.repo}/actions/runs/${runId}/jobs?per_page=50`,
    );
    const record = asRecord(reply.data);
    const rawJobs = Array.isArray(record['jobs']) ? record['jobs'] : [];
    const total =
      typeof record['total_count'] === 'number' ? record['total_count'] : rawJobs.length;

    if (total > rawJobs.length) {
      throw new Error(`GitHub reported ${total} jobs but returned ${rawJobs.length}`);
    }

    const jobs: GithubJob[] = [];
    for (const raw of rawJobs) {
      const job = parseJob(raw);
      if (job) jobs.push(job);
    }
    return { data: jobs, rateLimitRemaining: reply.rateLimitRemaining };
  }
}
