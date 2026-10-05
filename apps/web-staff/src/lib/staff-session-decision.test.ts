import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MeSession } from '@myclash/api-client';

import { answeredFault, resolveStaffSession } from './staff-session-decision';

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

  // Operator ruling 295a. An organiser with an account and no PIN opens the pad during a
  // database fault: `/me` ANSWERS, with a server error. She is signed in; "sign in" is false.
  it('says "could not check" when /me answered a fault', () => {
    expect(resolveStaffSession(false, null, true)).toEqual({ kind: 'unverified' });
  });

  it('still opens the pad for a PIN session, whatever /me would say', () => {
    expect(resolveStaffSession(true, null, true)).toEqual({ kind: 'allow' });
  });
});

describe('answeredFault', () => {
  it('is a failure the server answered', () => {
    const fault = { ok: false, kind: 'http', status: 500, detail: null, code: null };
    expect(answeredFault(fault as never)).toBe(true);
  });

  // Offline keeps the sign-in screen: that is where a tablet reads the hits it still holds
  // (ruling 241), and no answer came that could be asked again in a moment.
  it.each([
    ['a request that never landed', { ok: false, kind: 'network' }],
    ['a read that was not asked: the PIN session answered', null],
    ['a /me that was read', { ok: true, data: { type: 'anonymous' } }],
  ])('is not %s', (_what, result) => {
    expect(answeredFault(result as never)).toBe(false);
  });
});

describe('the pad’s two landing pages', () => {
  const source = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

  it.each(['app/page.tsx', 'app/lices/page.tsx'])('%s asks the decision with the fault', (path) => {
    expect(source(path)).toMatch(
      /resolveStaffSession\(\s*staff\.ok,\s*account\?\.ok \? account\.data : null,\s*answeredFault\(account\),?\s*\)/,
    );
  });

  it('the first page says so with a Retry and does not go to sign-in', () => {
    const page = source('app/page.tsx');
    expect(page).toMatch(
      /if \(decision\.kind === 'unverified'\) \{\s+setUnchecked\(true\);\s+return;\s+\}/,
    );
    expect(page).toContain("{t('common.identityUnchecked')}");
    expect(page).toMatch(
      /onClick=\{\(\) => window\.location\.reload\(\)\}[^>]*>\s+\{t\('common\.identityRetry'\)\}/,
    );
  });

  it('the pistes page says so in its own error screen, which has the Retry', () => {
    expect(source('app/lices/page.tsx')).toMatch(
      /if \(decision\.kind === 'unverified'\) \{\s+setError\(t\('common\.identityUnchecked'\)\);\s+return;\s+\}/,
    );
  });
});
