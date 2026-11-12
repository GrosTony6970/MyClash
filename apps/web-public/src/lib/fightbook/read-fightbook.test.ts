import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { SPAR_REFUSAL_CODES } from '@myclash/types';
import { en } from '@myclash/i18n';
import {
  readAskableAtEvent,
  readAskableFighter,
  readFightBookEvents,
  readFightBookSettings,
  readFindAtEvent,
  readFindBrowse,
  readInbox,
  readMySpars,
  readWeaponCatalog,
  writeFightBook,
} from './read-fightbook';
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

describe('the slice 2 reads', () => {
  const B = 'http://api.test';
  const card = {
    fighter: { globalPersonId: 'g', name: 'N', photoUrl: null, club: null },
    weapons: [],
  };
  const path = () => vi.mocked(apiRequest).mock.calls[0]?.[1];

  it('readAskableFighter needs a boolean askable', async () => {
    answer({ ok: true, data: { askable: false } });
    expect(await readAskableFighter(B, 'g-1')).toEqual({ kind: 'data', data: { askable: false } });
    expect(path()).toBe('/api/v1/me/fightbook/fighters/g-1/askable');
    answer({ ok: true, data: { askable: 'yes' } });
    expect(await readAskableFighter(B, 'g-1')).toEqual({ kind: 'failed' });
  });

  it('readAskableAtEvent accepts {} and string values, rejects the rest', async () => {
    answer({ ok: true, data: {} });
    expect(await readAskableAtEvent(B, 'e-1', ['p1', 'p2'])).toEqual({ kind: 'data', data: {} });
    expect(path()).toBe('/api/v1/me/fightbook/events/e-1/askable?persons=p1%2Cp2');
    answer({ ok: true, data: { p1: 'g1' } });
    expect((await readAskableAtEvent(B, 'e-1', ['p1'])).kind).toBe('data');
    for (const bad of [[], null, { a: 1 }]) {
      answer({ ok: true, data: bad });
      expect(await readAskableAtEvent(B, 'e-1', ['p1'])).toEqual({ kind: 'failed' });
    }
  });

  it('the list reads reject {} and an item that is not the shape', async () => {
    answer({ ok: true, data: {} });
    expect(await readFightBookEvents(B)).toEqual({ kind: 'failed' });
    answer({ ok: true, data: [{ id: 'e', name: 'E' }] });
    expect(await readFightBookEvents(B)).toEqual({ kind: 'failed' });
    answer({ ok: true, data: [{ id: 'e', name: 'E', days: [], today: null }] });
    expect((await readFightBookEvents(B)).kind).toBe('data');
    answer({ ok: true, data: {} });
    expect(await readFindAtEvent(B, 'e-1', '')).toEqual({ kind: 'failed' });
    answer({ ok: true, data: {} });
    expect(await readFindBrowse(B, '', '', 0)).toEqual({ kind: 'failed' });
    answer({ ok: true, data: { items: [card] } });
    expect(await readFindBrowse(B, '', '', 0)).toEqual({ kind: 'failed' });
    answer({ ok: true, data: { items: [card], more: false } });
    expect((await readFindBrowse(B, '', '', 0)).kind).toBe('data');
  });

  it('browsing all of FightBook sends no empty filter: the API refuses weapon=', async () => {
    answer({ ok: true, data: { items: [], more: false } });
    await readFindBrowse(B, '', '', 0);
    expect(path()).toBe('/api/v1/me/fightbook/find?page=0');
  });

  it('readWeaponCatalog rejects a row without a string id and name', async () => {
    answer({ ok: true, data: [{ id: 'w1', name: 'Longsword' }] });
    expect((await readWeaponCatalog(B)).kind).toBe('data');
    expect(path()).toBe('/api/v1/weapons?active=true');
    for (const bad of [[{ name: 'x' }], [{ id: 'w1' }], [{ id: 1, name: 'x' }], {}]) {
      answer({ ok: true, data: bad });
      expect(await readWeaponCatalog(B)).toEqual({ kind: 'failed' });
    }
  });

  it('builds the query strings with URLSearchParams', async () => {
    answer({ ok: true, data: { items: [], more: false } });
    await readFindBrowse(B, 'Lé a&b', 'w-1', 2);
    expect(path()).toBe('/api/v1/me/fightbook/find?q=L%C3%A9+a%26b&weapon=w-1&page=2');
    vi.mocked(apiRequest).mockReset();
    answer({ ok: true, data: [] });
    await readFindAtEvent(B, 'e-1', 'w-1');
    expect(path()).toBe('/api/v1/me/fightbook/events/e-1/find?weapon=w-1');
    vi.mocked(apiRequest).mockReset();
    answer({ ok: true, data: [] });
    await readFindAtEvent(B, 'e-1', '');
    expect(path()).toBe('/api/v1/me/fightbook/events/e-1/find');
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
