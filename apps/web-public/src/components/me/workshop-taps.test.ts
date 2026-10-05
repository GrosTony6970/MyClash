import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tapEnded, tapStarted, type TapsInFlight } from './workshop-booking';

/**
 * A tap in flight keeps its own button busy on both booking pages.
 *
 * The pages held ONE busy session id. Lea taps Register on the morning session and, before the
 * server answers, on the afternoon one: the id moved, the morning button came back live while
 * its call was still out, and a second call for the same session could follow it.
 *
 * This package's vitest does not compile TSX: the set is a pure module, driven here, and the
 * pages are read as text for the wiring.
 */

const none: TapsInFlight = new Set();

describe('the sessions with a tap in flight', () => {
  it('a tap on a second session keeps the first one busy', () => {
    const taps = tapStarted(tapStarted(none, 's-morning'), 's-afternoon');

    expect([...taps]).toEqual(['s-morning', 's-afternoon']);
  });

  it('an answer frees its own session only', () => {
    const taps = tapStarted(tapStarted(none, 's-morning'), 's-afternoon');

    expect([...tapEnded(taps, 's-morning')]).toEqual(['s-afternoon']);
    expect([...tapEnded(tapEnded(taps, 's-morning'), 's-afternoon')]).toEqual([]);
  });

  it('hands React a new set each time: the one it holds is never changed', () => {
    const one = tapStarted(none, 's-morning');
    const two = tapStarted(one, 's-afternoon');
    const back = tapEnded(two, 's-afternoon');

    expect(none.size).toBe(0);
    expect([...one]).toEqual(['s-morning']);
    expect([...two]).toEqual(['s-morning', 's-afternoon']);
    expect(back).not.toBe(one);
  });
});

const source = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

describe.each([
  ['the public Workshop page', 'app/e/[eventSlug]/w/[workshopSlug]/page.tsx'],
  ['the personal Workshops page', 'app/me/events/[eventSlug]/workshops/page.tsx'],
])('%s', (_name, path) => {
  const page = source(path);

  it('holds every session with a tap in flight, never one id', () => {
    expect(page).toContain('const [busy, setBusy] = useState<TapsInFlight>(new Set());');
    expect(page).toContain('busy={busy.has(session.id)}');
    expect(page).not.toContain('busy === session.id');
  });

  it('a tap adds its session, and its own answer takes it out', () => {
    expect(page).toContain('setBusy((taps) => tapStarted(taps, sessionId));');
    expect(page).toContain('setBusy((taps) => tapEnded(taps, sessionId));');
    expect(page).not.toContain('setBusy(null)');
    expect(page).not.toContain('setBusy(sessionId)');
  });
});
