import { metricErrorText, type TileRow } from './queue-rows';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A container that crashed, is unhealthy, or has no container at all (`state: 'missing'`). */
export interface ContainerProblem {
  service: string;
  state: string;
  exitCode: number | null;
  health: string | null;
}

/** The runtime-health containers metric, as the API sends it (ruling 900). */
export type ContainersTile =
  | { status: 'healthy' | 'critical'; running: number; total: number; problems: ContainerProblem[] }
  | { status: 'not_configured' }
  | { status: 'unavailable'; error?: string };

/** The label/value rows of the containers tile: the count, then one critical row per problem. */
export function containerRows(t: Translate, m: ContainersTile): TileRow[] {
  const running = t('admin.systemVersions.runtimeHealth.containers.running');
  switch (m.status) {
    case 'healthy':
    case 'critical':
      return [
        [
          running,
          t('admin.systemVersions.runtimeHealth.containers.runningCount', {
            running: m.running,
            total: m.total,
          }),
        ],
        ...m.problems.map((p): TileRow => [
          p.service,
          problemText(t, p),
          'critical',
          `problem-${p.service}`,
        ]),
      ];
    case 'not_configured':
      return [[running, t('admin.systemVersions.runtimeHealth.containers.notConfigured')]];
    case 'unavailable':
      return [[t('admin.systemVersions.runtimeHealth.unavailable'), metricErrorText(t, m.error)]];
  }
}

function problemText(t: Translate, p: ContainerProblem): string {
  if (p.health === 'unhealthy') return t('admin.systemVersions.runtimeHealth.containers.unhealthy');
  if (p.state === 'missing') return t('admin.systemVersions.runtimeHealth.containers.missing');
  if (p.exitCode === null) return p.state;
  return t('admin.systemVersions.runtimeHealth.containers.stateWithCode', {
    state: p.state,
    code: p.exitCode,
  });
}
