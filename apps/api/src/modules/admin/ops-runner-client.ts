import { OperationalUnavailableException } from '../../common/operational-exception';
import { opsRunnerException, readOpsRunnerError } from './ops-runner-error';

/**
 * The API's one road to the ops runner (`infra/ops-runner/server.mjs`, internal network, bearer
 * secret): the backups and the backup uploads go through it. A runner that is not configured, does
 * not answer in time, or answers a failure becomes the exception the browser should see.
 */
export const OPS_RUNNER_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

export interface OpsRunnerClientOptions {
  opsRunnerUrl?: string;
  opsRunnerSecret?: string;
  fetchImpl?: FetchLike;
}

export class OpsRunnerClient {
  readonly url: string;
  private readonly secret: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: OpsRunnerClientOptions = {}) {
    this.url = stripTrailingSlash(options.opsRunnerUrl ?? process.env['OPS_RUNNER_URL']);
    this.secret = options.opsRunnerSecret ?? process.env['OPS_RUNNER_SECRET'] ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  available(): boolean {
    return Boolean(this.url && this.secret);
  }

  headers(): Record<string, string> {
    return { authorization: `Bearer ${this.secret}` };
  }

  fetch(input: string | URL, init: RequestInit): Promise<Response> {
    return this.fetchImpl(input, init);
  }

  get<T>(route: string): Promise<T> {
    return this.request<T>(route, { method: 'GET' });
  }

  post<T>(route: string, body: unknown): Promise<T> {
    return this.json<T>('POST', route, body);
  }

  put<T>(route: string, body: unknown): Promise<T> {
    return this.json<T>('PUT', route, body);
  }

  delete<T>(route: string): Promise<T> {
    return this.request<T>(route, { method: 'DELETE' });
  }

  async request<T>(route: string, init: RequestInit): Promise<T> {
    if (!this.available()) {
      throw new OperationalUnavailableException('Backup operations require the ops runner.');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${route}`, {
        ...init,
        headers: { ...this.headers(), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(OPS_RUNNER_TIMEOUT_MS),
      });
    } catch (error) {
      // AbortSignal.timeout raises a plain TimeoutError, not an HttpException,
      // so this used to surface as an anonymous scrubbed 500 while the runner
      // carried on working in the background — the exact shape of the
      // "Could not delete backups" report that had no cause attached.
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new OperationalUnavailableException(
        timedOut
          ? `The ops runner did not respond within ${OPS_RUNNER_TIMEOUT_MS / 1000}s. It may still be working — reload before retrying.`
          : 'Could not reach the ops runner.',
      );
    }

    if (!response.ok) {
      throw opsRunnerException(response.status, await readOpsRunnerError(response));
    }
    return (await response.json()) as T;
  }

  private json<T>(method: string, route: string, body: unknown): Promise<T> {
    return this.request<T>(route, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}

function stripTrailingSlash(value: string | undefined): string {
  return value?.replace(/\/+$/, '') ?? '';
}
