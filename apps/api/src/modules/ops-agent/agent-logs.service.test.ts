import { describe, expect, it, vi } from 'vitest';
import { AgentLogsService } from './agent-logs.service';

const URL = 'http://ops-runner:4075';

function build(body: unknown) {
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const service = new AgentLogsService({
    opsRunnerUrl: URL,
    opsRunnerSecret: 'runner-secret',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { service, fetchImpl };
}

describe('AgentLogsService.log', () => {
  it('asks the runner for one service, with the line count and the errors flag', async () => {
    const { service, fetchImpl } = build({ generatedAt: 'g', lines: [], truncated: false });

    await service.log('api', { lines: 50, errors: true });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL}/logs/api?lines=50&errors=1`);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer runner-secret');
  });

  it('leaves the errors flag out when it is off', async () => {
    const { service, fetchImpl } = build({ generatedAt: 'g', lines: [], truncated: false });

    await service.log('worker', { lines: 100, errors: false });

    expect(String(fetchImpl.mock.calls[0]![0 as never])).toBe(`${URL}/logs/worker?lines=100`);
  });

  // The spec's acceptance: "the log read is tested with a line that contains an email and a
  // phone number".
  it('scrubs every line, and passes nothing the runner adds', async () => {
    const { service } = build({
      generatedAt: 'g',
      service: 'api',
      lines: ['sent to a@b.fr, call +33 6 12 34 56 78, from 82.66.103.92'],
      truncated: true,
      stderr: 'marker-stderr',
    });

    const answer = await service.log('api', { lines: 10, errors: false });

    expect(answer).toEqual({
      generatedAt: 'g',
      service: 'api',
      lines: ['sent to [redacted-email], call [redacted-phone], from 82.66.x.x'],
      truncated: true,
    });
    expect(JSON.stringify(answer)).not.toContain('marker');
  });
});
