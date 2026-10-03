import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveHubSwitch, withHubSwitch } from './hub-follow-switch';
import type { PersonFollowing } from './personContext';

/**
 * The hub follow's switch "notify when refereeing" on a card of the Following tab (operator
 * rulings 217, 217a).
 *
 * A person followed from the People hub alone had no switch: the three of a card speak for his
 * coming Event follows. The hub switch is saved on the hub follow itself, by the person's profile
 * id.
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

describe('saving the hub switch', () => {
  it.each([[true], [false]])('sends %s to the hub follow of that person', async (on) => {
    fetchMock.mockResolvedValue(answer(200, { globalPersonId: PAUL, notifyRefereeStart: on }));

    await expect(saveHubSwitch(API, PAUL, on)).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/v1/me/follows/by-global-person/${PAUL}`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ notifyRefereeStart: on }));
  });

  it.each([[404], [500]])('hands back the status of a refusal: %s', async (status) => {
    fetchMock.mockResolvedValue(answer(status, { detail: 'no' }));

    await expect(saveHubSwitch(API, PAUL, true)).resolves.toEqual({ ok: false, status });
  });

  it('hands back no status for a request that never landed', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(saveHubSwitch(API, PAUL, true)).resolves.toEqual({ ok: false, status: null });
  });
});

describe('the list after a tap', () => {
  const card = (globalPersonId: string, on: boolean) =>
    ({ globalPersonId, hubFollow: { notifyRefereeStart: on } }) as PersonFollowing;
  const list = [card('gp-lea', false), card(PAUL, false), card('gp-tom', true)];

  it('changes the MIDDLE card alone, and leaves the others the same objects', () => {
    const next = withHubSwitch(list, PAUL, true);

    expect(next.map((follow) => follow.hubFollow.notifyRefereeStart)).toEqual([false, true, true]);
    expect(next[0]).toBe(list[0]);
    expect(next[2]).toBe(list[2]);
    // A new object, so React sees the change; the list handed in is not touched.
    expect(next[1]).not.toBe(list[1]);
    expect(list[1]?.hubFollow.notifyRefereeStart).toBe(false);
  });

  it('changes nothing for a person who is not in the list', () => {
    expect(withHubSwitch(list, 'gp-nobody', true)).toEqual(list);
  });
});

describe('the wiring of the card', () => {
  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

  it('the Following tab saves the hub switch, and puts it back with a word when the save fails', () => {
    const source = read('FollowsClient.tsx');
    expect(source).toContain(
      'setFollows((prev) => withHubSwitch(prev, follow.globalPersonId, value));',
    );
    expect(source).toContain(
      'const saved = await saveHubSwitch(apiUrl, follow.globalPersonId, value);',
    );
    expect(source).toContain('if (saved.ok) return;');
    expect(source).toContain(
      'setFollows((prev) => withHubSwitch(prev, follow.globalPersonId, !value));',
    );
    expect(source).toContain("t(refusalKey(saved.status, 'publicApp.me.follows.updateFailed'))");
    expect(source).toContain('onHubToggle={(value) => void toggleHub(follow, value)}');
  });

  it('every card has the hub switch; the Event switches only with a coming Event follow', () => {
    const source = read('FollowSwitches.tsx');
    expect(source).toContain('checked={follow.hubFollow.notifyRefereeStart}');
    expect(source).toContain('onChange={onHubToggle}');
    expect(source).toContain('const { eventFollow } = follow;');
    // Beside the Event's own referee switch, the hub switch says what it covers.
    expect(source).toMatch(
      /eventFollow\s*\? 'publicApp\.me\.follows\.notifyRefereeElsewhere'\s*: 'publicApp\.me\.follows\.notifyReferee'/,
    );
    // The switches have one owner: the card renders it and holds none of its own.
    expect(read('FollowsClient.tsx')).not.toContain('<Switch');
  });

  it('the type of a card and the API name the same field', () => {
    expect(read('personContext.ts')).toContain('hubFollow: { notifyRefereeStart: boolean };');
    const controller = readFileSync(
      join(__dirname, '../../../../api/src/modules/people-context/me-people.controller.ts'),
      'utf8',
    );
    expect(controller).toContain('hubFollow: { notifyRefereeStart: f.notifyRefereeStart },');
  });
});
