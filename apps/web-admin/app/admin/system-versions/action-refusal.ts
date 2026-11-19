import type { ApiFailure } from '@myclash/api-client';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The ops runner's refusals of a container action or a certificate renewal, by their code, in the
 * reader's language: its lock is held (ruling 886), or a deploy is running (ruling 887). Null for
 * every other failure: the caller's `failureMessage`.
 */
export function systemActionRefusal(failure: ApiFailure, t: Translate): string | null {
  const code = failure.kind === 'http' ? failure.code : null;
  if (code === 'ops_busy') return t('admin.backups.opsBusy');
  if (code === 'deploy_running') return t('admin.systemVersions.actions.deployRunning');
  return null;
}
