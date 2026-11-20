import { describe, expect, it } from 'vitest';
import { containerRows } from './container-rows';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;
const K = 'admin.systemVersions.runtimeHealth.containers';

describe('containerRows', () => {
  it('shows how many run when all is well', () => {
    expect(containerRows(t, { status: 'healthy', running: 15, total: 16, problems: [] })).toEqual([
      [`${K}.running`, `${K}.runningCount {"running":15,"total":16}`],
    ]);
  });

  it('adds one critical row per problem, keyed by its service', () => {
    const rows = containerRows(t, {
      status: 'critical',
      running: 14,
      total: 16,
      problems: [
        { service: 'web-public', state: 'exited', exitCode: 1, health: null },
        { service: 'api', state: 'running', exitCode: 0, health: 'unhealthy' },
        { service: 'web-marketing', state: 'missing', exitCode: null, health: null },
        { service: 'worker', state: 'restarting', exitCode: null, health: null },
      ],
    });
    expect(rows.slice(1)).toEqual([
      [
        'web-public',
        `${K}.stateWithCode {"state":"exited","code":1}`,
        'critical',
        'problem-web-public',
      ],
      ['api', `${K}.unhealthy`, 'critical', 'problem-api'],
      ['web-marketing', `${K}.missing`, 'critical', 'problem-web-marketing'],
      ['worker', 'restarting', 'critical', 'problem-worker'],
    ]);
  });

  it('says the containers are not read here when not configured', () => {
    expect(containerRows(t, { status: 'not_configured' })).toEqual([
      [`${K}.running`, `${K}.notConfigured`],
    ]);
  });

  it('shows the error when unavailable', () => {
    expect(containerRows(t, { status: 'unavailable', error: 'runner down' })).toEqual([
      ['admin.systemVersions.runtimeHealth.unavailable', 'runner down'],
    ]);
  });
});
