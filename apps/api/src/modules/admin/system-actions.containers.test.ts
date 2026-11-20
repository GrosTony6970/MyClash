import { describe, expect, it, vi } from 'vitest';
import { AdminSystemActionsService } from './system-actions.service';

/** No audit row is written by a read: the database client is never touched. */
function makeService(fetchImpl: typeof fetch, url = 'http://ops-runner:4075', secret = 'shhh') {
  return new AdminSystemActionsService({} as never, {
    opsRunnerUrl: url,
    opsRunnerSecret: secret,
    fetchImpl,
  });
}

describe('AdminSystemActionsService.getContainers (the door and runtime health, ruling 900)', () => {
  it('reads GET /containers and copies six fields of each container, and nothing else', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            generatedAt: 'g',
            containers: [
              {
                name: 'myclash-api',
                service: 'api',
                state: 'running',
                health: 'healthy',
                status: 'Up 6 hours (healthy)',
                exitCode: 0,
                Labels: 'marker-labels',
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const service = makeService(fetchImpl as unknown as typeof fetch);

    const answer = await service.getContainers();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://ops-runner:4075/containers');
    expect(init.method).toBe('GET');
    expect(answer).toEqual({
      generatedAt: 'g',
      containers: [
        {
          name: 'myclash-api',
          service: 'api',
          state: 'running',
          health: 'healthy',
          status: 'Up 6 hours (healthy)',
          exitCode: 0,
        },
      ],
    });
    expect(JSON.stringify(answer)).not.toContain('marker');
  });

  it('says whether the ops runner is configured', () => {
    const noFetch = vi.fn() as unknown as typeof fetch;
    expect(makeService(noFetch).opsAvailable()).toBe(true);
    expect(makeService(noFetch, '', '').opsAvailable()).toBe(false);
  });
});
