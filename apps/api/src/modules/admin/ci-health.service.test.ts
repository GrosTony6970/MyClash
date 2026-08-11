import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { AdminCiHealthService } from './ci-health.service';
import { CI_GATES } from './ci-health/gates';
import type { GithubClient, GithubJob, GithubRun } from './ci-health/github';

/**
 * The behaviour under test is the JOIN, not the HTTP.
 *
 * `github.ts` owns the network and throws on any bad answer; this service owns
 * the one question the card exists to ask — did every gate we expect actually
 * report? — plus the promise that it never throws while asking it.
 */

const RUN: GithubRun = {
  id: 31370699208,
  runNumber: 1249,
  sha: 'd5d49694f621',
  conclusion: 'failure',
  createdAt: '2026-08-10T08:34:57Z',
  url: 'https://github.com/GrosTony6970/MyClash/actions/runs/31370699208',
};

/**
 * A run where every expected gate reported success.
 *
 * Matrix gates are expanded into two legs under GitHub's real naming, because
 * building jobs straight from CI_GATES is how the first version of this fixture
 * agreed with the code by construction and hid a live `not_reported` on all four
 * Trivy legs.
 */
function allGreenJobs(): GithubJob[] {
  const jobs: GithubJob[] = [];
  const byJob = new Map<string, GithubJob>();

  for (const gate of CI_GATES) {
    if (gate.matrix) {
      for (const leg of MATRIX_LEGS) {
        jobs.push({
          name: `${gate.job} (${leg})`,
          conclusion: 'success',
          steps: [{ name: gate.step, conclusion: 'success' }],
        });
      }
      continue;
    }
    const job = byJob.get(gate.job) ?? { name: gate.job, conclusion: 'success', steps: [] };
    job.steps.push({ name: gate.step, conclusion: 'success' });
    byJob.set(gate.job, job);
  }

  return [...byJob.values(), ...jobs];
}

const MATRIX_LEGS = [
  'myclash-api, apps/api/Dockerfile',
  'myclash-web-admin, apps/web-admin/Dockerfile',
];

/** The one matrix gate in CI_GATES today; the tests below assert its folding. */
const MATRIX_GATE = CI_GATES.find((g) => g.matrix)!;

function configOf(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function clientOf(overrides: Partial<GithubClient>): GithubClient {
  return {
    latestRun: vi.fn().mockResolvedValue({ data: RUN, rateLimitRemaining: 58 }),
    jobsForRun: vi.fn().mockResolvedValue({ data: allGreenJobs(), rateLimitRemaining: 57 }),
    lastAllGreenRun: vi.fn().mockResolvedValue({ data: null, rateLimitRemaining: 56 }),
    ...overrides,
  } as unknown as GithubClient;
}

function serviceWith(
  client: GithubClient,
  config = configOf(),
  now = () => 1_000_000,
): AdminCiHealthService {
  return new AdminCiHealthService(config, () => client, now);
}

describe('AdminCiHealthService', () => {
  it('reports one row per expected gate, in workflow order', async () => {
    const answer = await serviceWith(clientOf({})).collect();

    expect(answer.status).toBe('ok');
    expect(answer.gates).toHaveLength(CI_GATES.length);
    expect(answer.gates.map((g) => `${g.job} / ${g.step}`)).toEqual(
      CI_GATES.map((g) => `${g.job} / ${g.step}`),
    );
    expect(answer.gates.every((g) => g.verdict === 'passed')).toBe(true);
    expect(answer.notReportedCount).toBe(0);
  });

  /**
   * The six-week bug, reproduced. A gate that stops running does not come back
   * as `skipped` — it comes back as nothing at all, and a card that only renders
   * what CI reported would show a clean table.
   */
  it('marks a gate CI never mentioned as not_reported', async () => {
    const jobs = allGreenJobs();
    const lint = jobs.find((j) => j.name === 'Lint');
    lint!.steps = lint!.steps.filter((s) => s.name !== 'Check code complexity budget');

    const answer = await serviceWith(
      clientOf({ jobsForRun: vi.fn().mockResolvedValue({ data: jobs, rateLimitRemaining: 57 }) }),
    ).collect();

    const complexity = answer.gates.find((g) => g.step === 'Check code complexity budget');
    expect(complexity?.verdict).toBe('not_reported');
    expect(answer.notReportedCount).toBe(1);
    // Every other gate is unaffected — the diff is per gate, not per job.
    expect(answer.gates.filter((g) => g.verdict === 'passed')).toHaveLength(CI_GATES.length - 1);
  });

  it('marks every gate of an absent job as not_reported', async () => {
    const jobs = allGreenJobs().filter((j) => j.name !== 'Lint');
    const expected = CI_GATES.filter((g) => g.job === 'Lint').length;

    const answer = await serviceWith(
      clientOf({ jobsForRun: vi.fn().mockResolvedValue({ data: jobs, rateLimitRemaining: 57 }) }),
    ).collect();

    expect(answer.notReportedCount).toBe(expected);
  });

  it('distinguishes a skipped step from an unreported one', async () => {
    const jobs = allGreenJobs();
    const lint = jobs.find((j) => j.name === 'Lint');
    lint!.steps = lint!.steps.map((s) =>
      s.name === 'Check formatting' ? { ...s, conclusion: 'skipped' } : s,
    );

    const answer = await serviceWith(
      clientOf({ jobsForRun: vi.fn().mockResolvedValue({ data: jobs, rateLimitRemaining: 57 }) }),
    ).collect();

    expect(answer.gates.find((g) => g.step === 'Check formatting')?.verdict).toBe('skipped');
    expect(answer.notReportedCount).toBe(0);
  });

  it('reads a still-running or failed step as failed, never as passed', async () => {
    const jobs = allGreenJobs();
    const test = jobs.find((j) => j.name === 'Test');
    test!.steps = [{ name: 'Run tests', conclusion: null }];

    const answer = await serviceWith(
      clientOf({ jobsForRun: vi.fn().mockResolvedValue({ data: jobs, rateLimitRemaining: 57 }) }),
    ).collect();

    expect(answer.gates.find((g) => g.step === 'Run tests')?.verdict).toBe('failed');
  });

  /**
   * Regression for a defect the mocks could not see. GitHub appends the matrix
   * values to a matrix job's name, so equality matching reported every Trivy leg
   * as `not_reported` against the live API while every unit test passed.
   */
  it('matches a matrix job by its expanded leg names', async () => {
    const answer = await serviceWith(clientOf({})).collect();

    const trivy = answer.gates.find((g) => g.step === MATRIX_GATE.step);
    expect(trivy?.verdict).toBe('passed');
    expect(answer.notReportedCount).toBe(0);
  });

  it('folds matrix legs worst-first, so a green leg cannot hide a red one', async () => {
    const jobs = allGreenJobs().map((j) =>
      j.name === `${MATRIX_GATE.job} (${MATRIX_LEGS[1]})`
        ? { ...j, steps: [{ name: MATRIX_GATE.step, conclusion: 'failure' }] }
        : j,
    );

    const answer = await serviceWith(
      clientOf({ jobsForRun: vi.fn().mockResolvedValue({ data: jobs, rateLimitRemaining: 57 }) }),
    ).collect();

    expect(answer.gates.find((g) => g.step === MATRIX_GATE.step)?.verdict).toBe('failed');
  });

  it('reports a matrix gate as not_reported only when no leg ran', async () => {
    const jobs = allGreenJobs().filter((j) => !j.name.startsWith(`${MATRIX_GATE.job} (`));

    const answer = await serviceWith(
      clientOf({ jobsForRun: vi.fn().mockResolvedValue({ data: jobs, rateLimitRemaining: 57 }) }),
    ).collect();

    expect(answer.gates.find((g) => g.step === MATRIX_GATE.step)?.verdict).toBe('not_reported');
    expect(answer.notReportedCount).toBe(1);
  });

  it('returns unavailable with a reason instead of throwing', async () => {
    const answer = await serviceWith(
      clientOf({ latestRun: vi.fn().mockRejectedValue(new Error('GitHub answered 503')) }),
    ).collect();

    expect(answer.status).toBe('unavailable');
    expect(answer.error).toBe('GitHub answered 503');
    expect(answer.gates).toEqual([]);
  });

  it('still answers when the all-green lookup fails', async () => {
    const answer = await serviceWith(
      clientOf({ lastAllGreenRun: vi.fn().mockRejectedValue(new Error('rate limited')) }),
    ).collect();

    // The green marker is context; losing it must not cost the gate table.
    expect(answer.status).toBe('ok');
    expect(answer.lastAllGreenRun).toBeNull();
    expect(answer.gates).toHaveLength(CI_GATES.length);
  });

  it('caches for ten minutes, then refetches', async () => {
    const latestRun = vi.fn().mockResolvedValue({ data: RUN, rateLimitRemaining: 58 });
    let clock = 1_000_000;
    const service = serviceWith(clientOf({ latestRun }), configOf(), () => clock);

    await service.collect();
    await service.collect();
    expect(latestRun).toHaveBeenCalledTimes(1);

    clock += 10 * 60 * 1000 + 1;
    await service.collect();
    expect(latestRun).toHaveBeenCalledTimes(2);
  });

  /**
   * A rate-limited API is exactly when a page-load-per-request would be worst,
   * so the failure is cached like any other answer.
   */
  it('caches an unavailable answer rather than retrying per request', async () => {
    const latestRun = vi.fn().mockRejectedValue(new Error('rate limit exhausted'));
    const service = serviceWith(clientOf({ latestRun }));

    await service.collect();
    await service.collect();

    expect(latestRun).toHaveBeenCalledTimes(1);
  });

  it('reports whether a token was configured', async () => {
    const anon = await serviceWith(clientOf({})).collect();
    expect(anon.authenticated).toBe(false);

    const authed = await serviceWith(clientOf({}), configOf({ GITHUB_TOKEN: 'ghp_x' })).collect();
    expect(authed.authenticated).toBe(true);
  });

  it('defaults the repo but honours GITHUB_REPO', async () => {
    const factory = vi.fn().mockReturnValue(clientOf({}));
    const service = new AdminCiHealthService(
      configOf({ GITHUB_REPO: 'someone/fork' }),
      factory,
      () => 1_000_000,
    );

    const answer = await service.collect();
    expect(answer.repo).toBe('someone/fork');
    expect(factory).toHaveBeenCalledWith('someone/fork', null);
  });
});
