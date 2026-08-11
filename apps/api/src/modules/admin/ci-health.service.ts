import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  CiGateRowDto,
  CiGateVerdict,
  CiHealthResponseDto,
  CiRunDto,
} from './dto/ci-health.dto';
import { CI_GATES } from './ci-health/gates';
import { GithubClient, type GithubJob, type GithubRun } from './ci-health/github';

/**
 * "Which gates ran, and which never reported" for the super-admin card.
 *
 * Never throws — a GitHub outage returns `status: 'unavailable'` with a reason,
 * the same contract as AdminHostInfoService and the runtime-health collectors.
 * An operator panel that 500s because a third party is down teaches the operator
 * to ignore the panel.
 *
 * Cached for ten minutes because the budget is the constraint, not freshness:
 * three calls per refresh against 60/hour unauthenticated. CI runs take minutes,
 * so a ten-minute-old answer is never meaningfully wrong.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_REPO = 'GrosTony6970/MyClash';
const DEFAULT_BRANCH = 'main';

/** GitHub step conclusions → the card's vocabulary. */
function verdictFor(conclusion: string | null): CiGateVerdict {
  if (conclusion === 'success') return 'passed';
  if (conclusion === 'skipped') return 'skipped';
  if (conclusion === 'cancelled') return 'cancelled';
  // failure, timed_out, action_required, and null (still running) all read as
  // failed here: none of them is evidence the gate passed.
  return 'failed';
}

function toRunDto(run: GithubRun | null): CiRunDto | null {
  if (!run) return null;
  return {
    runNumber: run.runNumber,
    sha: run.sha,
    conclusion: run.conclusion,
    createdAt: run.createdAt,
    url: run.url,
  };
}

/**
 * Worst-first, so folding a matrix job's legs can never let a green leg hide a
 * red one. `not_reported` is deliberately the worst of all: a gate that vanished
 * is a bigger problem than one that failed loudly.
 */
const VERDICT_RANK: Record<CiGateVerdict, number> = {
  not_reported: 0,
  failed: 1,
  cancelled: 2,
  skipped: 3,
  passed: 4,
};

function worst(a: CiGateVerdict, b: CiGateVerdict): CiGateVerdict {
  return VERDICT_RANK[a] <= VERDICT_RANK[b] ? a : b;
}

/**
 * Does this reported job name belong to this gate?
 *
 * Exact for an ordinary job. A matrix job also matches its expanded legs, which
 * GitHub names `<declared> (<matrix values>)`.
 */
function jobMatches(gate: (typeof CI_GATES)[number], reportedJob: string): boolean {
  if (reportedJob === gate.job) return true;
  return gate.matrix === true && reportedJob.startsWith(`${gate.job} (`);
}

/**
 * Join the expectation against what CI said.
 *
 * A gate CI never mentioned becomes `not_reported`. That is the whole point of
 * holding CI_GATES separately: if this list were derived from the same API
 * response, a vanished gate would be undetectable by construction.
 */
function buildGateRows(jobs: GithubJob[]): CiGateRowDto[] {
  return CI_GATES.map((gate) => {
    let verdict: CiGateVerdict | null = null;

    for (const job of jobs) {
      if (!jobMatches(gate, job.name)) continue;
      for (const step of job.steps) {
        if (step.name !== gate.step) continue;
        const seen = verdictFor(step.conclusion);
        verdict = verdict === null ? seen : worst(verdict, seen);
      }
    }

    return { job: gate.job, step: gate.step, verdict: verdict ?? 'not_reported' };
  });
}

/** The fields every answer carries, available before any request lands. */
interface AnswerBase {
  checkedAt: string;
  repo: string;
  authenticated: boolean;
}

/** One shape for every "we cannot say", so the card never renders a half-answer. */
function unavailable(
  base: AnswerBase,
  error: string,
  rateLimitRemaining: number | null,
): CiHealthResponseDto {
  return {
    ...base,
    status: 'unavailable',
    latestRun: null,
    lastAllGreenRun: null,
    gates: [],
    notReportedCount: 0,
    rateLimitRemaining,
    error,
  };
}

interface CachedAnswer {
  answer: CiHealthResponseDto;
  expiresAt: number;
}

@Injectable()
export class AdminCiHealthService {
  private readonly logger = new Logger(AdminCiHealthService.name);
  private cache: CachedAnswer | null = null;

  constructor(
    private readonly config: ConfigService,
    /** Injected for tests; production builds one per call from config. */
    private readonly clientFactory?: (repo: string, token: string | null) => GithubClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async collect(): Promise<CiHealthResponseDto> {
    const cached = this.cache;
    if (cached && cached.expiresAt > this.now()) return cached.answer;

    const answer = await this.fetchAnswer();
    // Cache the unavailable answer too: a rate-limited API must not be hammered
    // once per page load precisely when its budget is gone.
    this.cache = { answer, expiresAt: this.now() + CACHE_TTL_MS };
    return answer;
  }

  private async fetchAnswer(): Promise<CiHealthResponseDto> {
    const repo = this.config.get<string>('GITHUB_REPO') ?? DEFAULT_REPO;
    const token = this.config.get<string>('GITHUB_TOKEN') ?? null;
    const branch = this.config.get<string>('GITHUB_DEFAULT_BRANCH') ?? DEFAULT_BRANCH;
    const client = this.clientFactory
      ? this.clientFactory(repo, token)
      : new GithubClient(repo, token);

    const base: AnswerBase = {
      checkedAt: new Date(this.now()).toISOString(),
      repo,
      authenticated: Boolean(token),
    };

    try {
      return await this.readRun(client, branch, base);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'GitHub request failed';
      this.logger.warn(`CI health unavailable: ${reason}`);
      return unavailable(base, reason, null);
    }
  }

  private async readRun(
    client: GithubClient,
    branch: string,
    base: AnswerBase,
  ): Promise<CiHealthResponseDto> {
    const latest = await client.latestRun(branch);
    if (!latest.data) {
      return unavailable(base, `No CI run found on ${branch}`, latest.rateLimitRemaining);
    }

    const jobs = await client.jobsForRun(latest.data.id);
    // The green marker is context, not the headline, so it must never sink the
    // answer: a repo can have no all-green run at all.
    const green = await client
      .lastAllGreenRun(branch)
      .catch(() => ({ data: null, rateLimitRemaining: null }));

    const gates = buildGateRows(jobs.data);
    return {
      ...base,
      status: 'ok',
      latestRun: toRunDto(latest.data),
      lastAllGreenRun: toRunDto(green.data),
      gates,
      notReportedCount: gates.filter((g) => g.verdict === 'not_reported').length,
      rateLimitRemaining:
        green.rateLimitRemaining ?? jobs.rateLimitRemaining ?? latest.rateLimitRemaining,
    };
  }
}
