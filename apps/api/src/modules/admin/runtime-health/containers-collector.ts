import { EXPECTED_SERVICES } from '../../ops-agent/expected-services';
import type { ContainerProblem } from '../dto/runtime-health.dto';
import type { AdminSystemActionsService, ContainerRow } from '../system-actions.service';

export type ContainersReading =
  | { configured: false }
  | { configured: true; running: number; total: number; problems: ContainerProblem[] };

/** Exit codes of a stop on purpose (ruling 887): 0, or 143 (SIGTERM, `docker stop`). */
const STOPPED_ON_PURPOSE: readonly number[] = [0, 143];
const SETTLED_STATES: readonly string[] = ['running', 'exited', 'created'];

/**
 * The containers that crashed or are unhealthy (ruling 900). One owner of "dead", and the same
 * rule as the ops skill's repairs (§7): unhealthy; a state that is neither running, exited nor
 * created (restarting, dead, paused…); or exited/created with an exit code other than 0 and 143.
 * An unknown exit code is not a problem here: the skill reports it as a note.
 */
export function deadContainers(rows: readonly ContainerRow[]): ContainerProblem[] {
  return rows.filter(isDead).map(({ service, state, exitCode, health }) => ({
    service,
    state,
    exitCode,
    health,
  }));
}

function isDead(row: ContainerRow): boolean {
  if (row.health === 'unhealthy') return true;
  if (!SETTLED_STATES.includes(row.state)) return true;
  return (
    row.state !== 'running' &&
    typeof row.exitCode === 'number' &&
    !STOPPED_ON_PURPOSE.includes(row.exitCode)
  );
}

/** An expected service with no container at all. */
function missingServices(rows: readonly ContainerRow[]): ContainerProblem[] {
  const present = new Set(rows.map((row) => row.service));
  return EXPECTED_SERVICES.filter((service) => !present.has(service)).map((service) => ({
    service,
    state: 'missing',
    exitCode: null,
    health: null,
  }));
}

/** A problem in a few words, for the alert email and the wake-up text: `web-public exited 1`. */
export function describeContainerProblem(problem: ContainerProblem): string {
  if (problem.health === 'unhealthy') return `${problem.service} unhealthy`;
  const code = problem.exitCode === null ? '' : ` ${problem.exitCode}`;
  return `${problem.service} ${problem.state}${code}`;
}

/**
 * The containers metric's reading. Not configured without the ops runner (the dev api, ruling
 * 832); a failed read throws, and the service maps it to `unavailable`.
 */
export async function collectContainers(
  systemActions: Pick<AdminSystemActionsService, 'opsAvailable' | 'getContainers'>,
): Promise<ContainersReading> {
  if (!systemActions.opsAvailable()) return { configured: false };
  const { containers } = await systemActions.getContainers();
  return {
    configured: true,
    running: containers.filter((row) => row.state === 'running').length,
    total: containers.length,
    problems: [...deadContainers(containers), ...missingServices(containers)],
  };
}
