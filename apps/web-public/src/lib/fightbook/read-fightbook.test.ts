import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { SPAR_REFUSAL_CODES } from '@myclash/types';
import { en } from '@myclash/i18n';
import { readFightBookSettings, readInbox, readMySpars, writeFightBook } from './read-fightbook';
import { sparRefusalKey } from './refusal';

vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

afterEach(() => vi.mocked(apiRequest).mockReset());

const answer = (value: unknown) => vi.mocked(apiRequest).mockResolvedValueOnce(value as never);

describe('the FightBook reads', () => {
  it('reads the settings from its own route', async () => {
    answer({ ok: true, data: { hasProfile: true, enabled: false } });
    expect(await readFightBookSettings('http://api.test')).toEqual({
      kind: 'data',
      data: { hasProfile: true, enabled: false },
    });
    expect(vi.mocked(apiRequest).mock.calls[0]?.[1]).toBe('/api/v1/me/fightbook/settings');
  });

  it('says sign in again on a 401, and failed on a body that is not the shape', async () => {
    answer({ ok: false, kind: 'unauthenticated', status: 401, code: null });
    expect(await readInbox('http://api.test')).toEqual({ kind: 'signin' });
    answer({ ok: true, data: {} });
    expect(await readInbox('http://api.test')).toEqual({ kind: 'failed' });
    answer({ ok: true, data: { spars: [] } });
    expect(await readMySpars('http://api.test')).toEqual({ kind: 'failed' });
  });

  it('a 403 is no sign-in: it is a failed read', async () => {
    answer({ ok: false, kind: 'unauthenticated', status: 403, code: 'fightbook_off' });
    expect(await readInbox('http://api.test')).toEqual({ kind: 'failed' });
  });
});

describe('writeFightBook', () => {
  it('sends the body with its method and answers the refusal code', async () => {
    answer({ ok: false, kind: 'http', status: 409, code: 'not_open' });
    expect(
      await writeFightBook('http://api.test', '/api/v1/me/fightbook/requests/r-1/answer', 'POST', {
        answer: 'yes',
      }),
    ).toEqual({ ok: false, code: 'not_open' });
    expect(vi.mocked(apiRequest).mock.calls[0]?.[2]).toMatchObject({
      method: 'POST',
      body: { answer: 'yes' },
    });
  });
});

describe('sparRefusalKey', () => {
  it('has a sentence for every refusal code, and one for anything else', () => {
    const refusal = (en as { publicApp: { fightBook: { refusal: Record<string, string> } } })
      .publicApp.fightBook.refusal;
    for (const code of SPAR_REFUSAL_CODES) {
      expect(sparRefusalKey(code)).toBe(`publicApp.fightBook.refusal.${code}`);
      expect(refusal[code], code).toEqual(expect.any(String));
    }
    expect(sparRefusalKey('who_knows')).toBe('publicApp.fightBook.refusal.unknown');
    expect(sparRefusalKey(null)).toBe('publicApp.fightBook.refusal.unknown');
  });
});
