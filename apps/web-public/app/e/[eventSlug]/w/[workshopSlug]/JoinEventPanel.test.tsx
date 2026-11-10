// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../src/i18n/I18nProvider';
import { JoinEventPanel } from './JoinEventPanel';

/**
 * Bob, signed in and on no list, at an Event that lets people join by themselves (rulings 516,
 * 568). One tap joins with his profile's name, then books the session he tapped. With no profile,
 * the server asks for a name and two boxes appear. A refusal is said in the page's own words.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOIN = '/api/v1/me/events/ev-1/join';
let container: HTMLDivElement;
let root: Root;
let sent: Array<{ path: string; body: unknown }>;
let answers: Response[];
let onJoined: ReturnType<typeof vi.fn>;

const problem = (status: number, code: string, details?: Record<string, unknown>) =>
  new Response(JSON.stringify({ status, code, detail: 'x', ...(details ? { details } : {}) }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  sent = [];
  answers = [];
  onJoined = vi.fn(async () => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace('http://api.test', '');
      if (path !== JOIN || init?.method !== 'POST') throw new Error(`unexpected request ${path}`);
      sent.push({ path, body: JSON.parse(String(init.body)) });
      return answers.shift() ?? new Response(JSON.stringify({ personId: 'p-1', joined: 'new' }));
    }),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function type(field: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(field) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

async function open() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <JoinEventPanel apiUrl="http://api.test" eventId="ev-1" onJoined={onJoined} />
      </I18nProvider>,
    );
  });
}

const submit = async () => {
  await act(async () => {
    container.querySelector('form')!.requestSubmit();
  });
};
const boxes = () => [...container.querySelectorAll<HTMLInputElement>('input')];

describe('joining the Event from a Workshop page (ruling 568)', () => {
  it("joins with the profile's name (no box, nothing typed sent), then books the tapped session", async () => {
    await open();
    expect(boxes()).toHaveLength(0);
    await submit();
    expect(sent).toEqual([{ path: JOIN, body: {} }]);
    expect(onJoined).toHaveBeenCalledTimes(1);
  });

  it('asks for a name when the account has none, then sends the typed one', async () => {
    answers.push(problem(400, 'NAMES_REQUIRED'));
    await open();
    await submit();
    expect(onJoined).not.toHaveBeenCalled();
    expect(boxes()).toHaveLength(2);
    act(() => {
      type(boxes()[0]!, 'Bob');
      type(boxes()[1]!, 'Martin');
    });
    await submit();
    expect(sent[1]).toEqual({ path: JOIN, body: { givenName: 'Bob', familyName: 'Martin' } });
    expect(onJoined).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sameName', 'Someone with your name is already on the list'],
    ['yourProfile', 'Your profile is already on this event'],
    ['yourAddress', 'Your address is already on this event'],
  ])('says "ask the organiser" for %s, and books nothing', async (reason, words) => {
    answers.push(problem(409, 'ASK_ORGANISER', { reason }));
    await open();
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(words);
    expect(onJoined).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'BAD_REQUEST', 'Your account, Bob'],
    [409, 'CONFLICT', 'Already on this Event'],
  ])('never shows the English of another %s refusal (%s)', async (status, code, english) => {
    answers.push(
      new Response(JSON.stringify({ status, code, detail: english }), {
        status,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    await open();
    await submit();
    const alert = container.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert).toBe('You could not be added to the event.');
  });

  it.each([
    [409, 'SELF_JOIN_CLOSED', 'no longer lets people join'],
    [403, 'event_completed', 'This event is over'],
    [403, 'event_archived', 'This event is over'],
  ])('says %s %s in its own words, never the organiser-facing one', async (status, code, words) => {
    answers.push(problem(status, code));
    await open();
    await submit();
    const alert = container.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert).toContain(words);
    expect(alert).not.toContain('Re-open it');
    expect(onJoined).not.toHaveBeenCalled();
  });
});
