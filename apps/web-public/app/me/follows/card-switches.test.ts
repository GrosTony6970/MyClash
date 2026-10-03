import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCardSwitch, withCardSwitch } from './card-switches';
import type { PersonFollowing } from './personContext';

/**
 * The three alert switches of a card of the Following tab speak for every coming Event where the
 * person is followed (operator ruling 239).
 *
 * The card used to hold the follow of ONE Event and to save a tap for that Event alone. The save
 * now names the person, not an Event: the server writes every coming Event follow in one call.
 *
 * This package's vitest does not compile TSX, so the request and the list change live in a pure
 * module, driven here, and the components are read as text for the wiring.
 */

const API = 'https://api.example.test';
const PAUL = '11111111-1111-4111-8111-111111111111';
const fetchMock = vi.fn();
const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saving a switch of a card', () => {
  it.each<['notifyMatchStart' | 'notifyWorkshopStart' | 'notifyRefereeStart', boolean]>([
    ['notifyMatchStart', false],
    ['notifyWorkshopStart', true],
    ['notifyRefereeStart', true],
  ])('sends %s = %s for that person, and names no Event', async (key, on) => {
    fetchMock.mockResolvedValue(answer(200, { [key]: on }));

    await expect(saveCardSwitch(API, PAUL, key, on)).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/v1/me/follows/by-global-person/${PAUL}/events`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ [key]: on }));
  });

  it.each([[404], [500]])('hands back the status of a refusal: %s', async (status) => {
    fetchMock.mockResolvedValue(answer(status, { detail: 'no' }));

    await expect(saveCardSwitch(API, PAUL, 'notifyMatchStart', true)).resolves.toEqual({
      ok: false,
      status,
    });
  });

  it('hands back no status for a request that never landed', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(saveCardSwitch(API, PAUL, 'notifyMatchStart', true)).resolves.toEqual({
      ok: false,
      status: null,
    });
  });
});

describe('the list after a tap', () => {
  const OFF = { notifyMatchStart: false, notifyWorkshopStart: false, notifyRefereeStart: false };
  const card = (globalPersonId: string, eventFollow: typeof OFF | null = OFF) =>
    ({ globalPersonId, eventFollow }) as PersonFollowing;
  const list = [card('gp-lea'), card(PAUL), card('gp-tom')];

  it('changes that switch of the MIDDLE card alone, and leaves the others the same objects', () => {
    const next = withCardSwitch(list, PAUL, 'notifyRefereeStart', true);

    expect(next.map((follow) => follow.eventFollow)).toEqual([
      OFF,
      { ...OFF, notifyRefereeStart: true },
      OFF,
    ]);
    expect(next[0]).toBe(list[0]);
    expect(next[2]).toBe(list[2]);
    // A new object, so React sees the change; the list handed in is not touched.
    expect(next[1]).not.toBe(list[1]);
    expect(list[1]?.eventFollow).toEqual(OFF);
  });

  it('leaves a card with no coming Event follow as it is', () => {
    const idle = [card(PAUL, null)];

    expect(withCardSwitch(idle, PAUL, 'notifyMatchStart', true)[0]).toBe(idle[0]);
  });
});

describe('the wiring of the card', () => {
  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

  it('the Following tab saves a tap by the person, and puts it back with a word when the save fails', () => {
    const source = read('FollowsClient.tsx');
    expect(source).toContain(
      'setFollows((prev) => withCardSwitch(prev, follow.globalPersonId, key, value));',
    );
    expect(source).toContain(
      'const saved = await saveCardSwitch(apiUrl, follow.globalPersonId, key, value);',
    );
    expect(source).toContain(
      'setFollows((prev) => withCardSwitch(prev, follow.globalPersonId, key, !value));',
    );
    expect(source).toContain('onToggle={(key, value) => void toggleNotify(follow, key, value)}');
    // No screen saves the switches of one Event any more (ruling 239a).
    expect(source).not.toMatch(/events\/\$\{[^}]*\}\/follows/);
  });

  it('the three switches show whenever the list hands them, with no Event to pick', () => {
    const source = read('FollowSwitches.tsx');
    expect(source).toContain('const { eventFollow } = follow;');
    expect(source).toContain('{eventFollow && (');
  });

  it('the type of a card names no Event', () => {
    const type = read('personContext.ts');
    const start = type.indexOf('eventFollow: {');
    const eventFollow = type.slice(start, type.indexOf('} | null;', start));
    expect(eventFollow).toContain('notifyRefereeStart: boolean;');
    expect(eventFollow).not.toMatch(/eventId|personId|active/);
  });
});
