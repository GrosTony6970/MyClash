import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { responseFailure, type MeSession } from '@myclash/api-client';

import { OFFLINE_CODE, offlineResponse } from '../offline/failure-kind';
import { answeredFault, neverLanded, resolveStaffSession } from './staff-session-decision';

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
    expect(resolveStaffSession(false, null)).toEqual({ kind: 'sign_in' });
  });

  // Operator, 2026-10-13. The tablet of piste 3 is opened at 14:00 with no
  // wifi: nobody can be asked who is signed in, and sign-in cannot work either.
  it('says "no network" when a read got no answer and nothing proved a session', () => {
    expect(resolveStaffSession(false, null, false, true)).toEqual({ kind: 'no_network' });
  });

  // The network came back between the two reads: a read that landed wins.
  it.each([
    ['a PIN session', true, null, false, 'allow'],
    ['a claimed account', false, me('claimed'), false, 'allow'],
    ['a /me that answered a fault', false, null, true, 'unverified'],
  ] as const)('%s outranks "no network"', (_what, pin, account, fault, kind) => {
    expect(resolveStaffSession(pin, account, fault, true)).toEqual({ kind });
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

  // No answer came that could be asked again in a moment: not "could not check".
  it.each([
    ['a request that never landed', { ok: false, kind: 'network' }],
    ['a read that was not asked: the PIN session answered', null],
    ['a /me that was read', { ok: true, data: { type: 'anonymous' } }],
  ])('is not %s', (_what, result) => {
    expect(answeredFault(result as never)).toBe(false);
  });

  // Under the service worker a dead network does not throw: the worker answers
  // a 503 of its own. Read as the server's, it sent a tablet with no network to
  // "we could not check who is signed in", whose Retry could only fail again.
  it('is not the service worker’s own answer to a dead network', async () => {
    const worker = { ok: false, ...responseFailure(503, await offlineResponse().json()) };

    expect(worker).toMatchObject({ kind: 'http', status: 503, code: OFFLINE_CODE });
    expect(answeredFault(worker as never)).toBe(false);
    // So the decision is the one of a request that never landed.
    expect(neverLanded(worker as never)).toBe(true);
    expect(
      resolveStaffSession(
        false,
        null,
        answeredFault(worker as never),
        neverLanded(worker as never),
      ),
    ).toEqual({ kind: 'no_network' });
  });

  // Ruling 295a stands: a server that is up and answers 503 has answered a fault.
  it.each([
    ['the edge with no API behind it', { detail: 'Bad Gateway' }],
    ['read-only mode', { code: 'read_only_mode', detail: 'Read-only' }],
    ['a body that is no JSON', undefined],
  ])('is a 503 of %s', (_what, body) => {
    const fault = { ok: false, ...responseFailure(503, body) };

    expect(answeredFault(fault as never)).toBe(true);
    expect(neverLanded(fault as never)).toBe(false);
  });
});

describe('neverLanded', () => {
  // With no service worker the request throws.
  it('is a request that got no answer', () => {
    expect(neverLanded({ ok: false, kind: 'network' })).toBe(true);
  });

  it.each([
    ['a read that was not asked', null],
    ['a read that was answered', { ok: true, data: { type: 'anonymous' } }],
    ['"nobody is signed in"', { ok: false, ...responseFailure(401, {}) }],
    ['a fault of the server', { ok: false, ...responseFailure(500, {}) }],
    ['a caller that gave up', { ok: false, kind: 'aborted' }],
  ])('is not %s', (_what, read) => {
    expect(neverLanded(read as never)).toBe(false);
  });
});

describe('the pad’s two landing pages', () => {
  const source = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

  it.each(['app/page.tsx', 'app/lices/page.tsx'])(
    '%s asks the decision with the fault and with "no answer" of either read',
    (path) => {
      expect(source(path)).toMatch(
        /resolveStaffSession\(\s*staff\.ok,\s*account\?\.ok \? account\.data : null,\s*answeredFault\(account\),\s*neverLanded\(staff\) \|\| neverLanded\(account\),\s*\)/,
      );
    },
  );

  // Operator, 2026-10-13: with no network both pages open the last piste.
  it('the first page opens the last piste with no network', () => {
    expect(source('app/page.tsx')).toMatch(
      /if \(decision\.kind === 'no_network'\) \{\s+router\.replace\(pisteWithNoNetwork\(rememberedPiste\(\)\)\);\s+return;\s+\}/,
    );
  });

  it('the pistes page does the same, and does not flash its list', () => {
    expect(source('app/lices/page.tsx')).toMatch(
      /if \(decision\.kind === 'no_network'\) \{\s+leaving = true;\s+router\.replace\(pisteWithNoNetwork\(rememberedPiste\(\)\)\);\s+return;\s+\}/,
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
