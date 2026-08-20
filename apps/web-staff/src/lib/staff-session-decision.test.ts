import { describe, expect, it } from 'vitest';
import type { MeSession } from '@myclash/api-client';

import { resolveStaffSession } from './staff-session-decision';

const me = (type: MeSession['type']): MeSession => ({ type });

describe('resolveStaffSession', () => {
  it('opens the pad for a staff PIN session without reading /me at all', () => {
    expect(resolveStaffSession(true, null)).toEqual({ kind: 'allow' });
  });

  // THE REGRESSION. This is the case that could never pass: the gate tested for
  // `type === 'user'`, which /me does not emit, so an organiser holding a valid
  // account session was sent to /login every time.
  it('opens the pad for a claimed account session with no PIN', () => {
    expect(resolveStaffSession(false, me('claimed'))).toEqual({ kind: 'allow' });
  });

  it.each(['guest', 'anonymous'] as const)('sends a %s session to sign in', (type) => {
    expect(resolveStaffSession(false, me(type))).toEqual({ kind: 'sign_in' });
  });

  it('sends an unreadable /me to sign in', () => {
    // Also the offline case. The pad cannot verify anyone here, and the sign-in
    // screen is the only honest answer — it is what the page did before, and
    // the running pad at /matches/[matchId] is not gated by this at all.
    expect(resolveStaffSession(false, null)).toEqual({ kind: 'sign_in' });
  });
});
