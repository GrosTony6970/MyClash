import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { systemActionRefusal } from './action-refusal';

const t = (key: string) => `[${key}]`;
const refused = (code: string | null): ApiFailure => ({
  kind: 'http',
  status: 409,
  detail: 'Another backup operation is already running.',
  validationErrors: null,
  code,
  details: null,
});

/**
 * The ops runner's refusals of a container action or a renewal (rulings 886, 887), in the
 * reader's language: the runner's English never reaches the toast.
 */
describe('systemActionRefusal', () => {
  it('words a held lock and a running deploy', () => {
    expect(systemActionRefusal(refused('ops_busy'), t)).toBe('[admin.backups.opsBusy]');
    expect(systemActionRefusal(refused('deploy_running'), t)).toBe(
      '[admin.systemVersions.actions.deployRunning]',
    );
  });

  it('leaves every other failure to the caller', () => {
    expect(systemActionRefusal(refused(null), t)).toBeNull();
    expect(systemActionRefusal(refused('something_else'), t)).toBeNull();
    expect(systemActionRefusal({ kind: 'aborted' }, t)).toBeNull();
  });
});
