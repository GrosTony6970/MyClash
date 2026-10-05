import { SIGNUPS_DISABLED_CODE } from '@myclash/types';
import { describe, expect, it, vi } from 'vitest';
import { OperationalUnavailableException } from '../../common/operational-exception';
import {
  mockSupabase as seededSupabase,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OnboardingService } from './onboarding.service';

/**
 * `OnboardingService.assertSignupsOpen`: the ONE read of the "sign-ups off" switch, asked by
 * the sign-up form, the mailed link's door and the Google sign-up (operator ruling 305).
 */
function build(feature_flags: TableSeed) {
  const db = seededSupabase({ feature_flags });
  return new OnboardingService(
    { service: db.service } as never,
    { sendMagicLink: vi.fn() } as never,
    { get: vi.fn() } as never,
    {} as never,
  );
}

describe('assertSignupsOpen (ruling 305)', () => {
  it('refuses with a coded answer a screen can read while the switch is on', async () => {
    const service = build({ rows: [{ key: 'disable_signups', enabled: true }] });

    const refusal = await service.assertSignupsOpen().catch((thrown: unknown) => thrown);

    // The marker class: the error filter keeps the code of this 503 and scrubs any other.
    expect(refusal).toBeInstanceOf(OperationalUnavailableException);
    expect((refusal as OperationalUnavailableException).getResponse()).toMatchObject({
      code: SIGNUPS_DISABLED_CODE,
    });
  });

  it.each<[string, TableSeed]>([
    ['the switch is off', { rows: [{ key: 'disable_signups', enabled: false }] }],
    ['another switch is on', { rows: [{ key: 'admin_lockdown', enabled: true }] }],
    // Ruling 109a: a kill switch that cannot be read is read as off, and leaves a warning.
    ['the switch cannot be read', { data: null, error: { message: 'connection refused' } }],
  ])('lets a sign-up through when %s', async (_label, flags) => {
    await expect(build(flags).assertSignupsOpen()).resolves.toBeUndefined();
  });
});
