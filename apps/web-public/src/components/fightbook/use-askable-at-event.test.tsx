// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { useAskableAtEvent } from './use-askable-at-event';

/**
 * Julie types "Pa", then "Pau", in an Event's people search. Each list of rows asks which of them
 * she may ask to spar. The answer for "Pa" may land after the rows for "Pau": it must never paint a
 * button on a row it did not cover.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = '5d0c1f0e-3f7b-4a39-9a4e-2b8e9c7d1a10';
const PA = ['p-pablo', 'p-paul'];
const PAU = ['p-paul'];
const pathFor = (ids: string[]) =>
  `/api/v1/me/fightbook/events/${EVENT}/askable?${new URLSearchParams({ persons: ids.join(',') })}`;

/** Each read waits until the test answers it. */
type Answer = (result: unknown) => void;
let answers: Map<string, Answer>;

let container: HTMLDivElement;
let root: Root;
let shown: Record<string, string>;
beforeEach(() => {
  answers = new Map();
  vi.mocked(apiRequest).mockImplementation(
    (_api, path) => new Promise((resolve) => answers.set(path, resolve)) as never,
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
});

function Probe(props: { eventId: string | null; ids: string[]; signedIn: boolean }) {
  shown = useAskableAtEvent('http://api.test', props.eventId, props.ids, props.signedIn);
  return null;
}

async function show(ids: string[], eventId: string | null = EVENT, signedIn = true) {
  // A new array on every render, as a page's `results.map(...)` makes.
  await act(async () =>
    root.render(<Probe eventId={eventId} ids={[...ids]} signedIn={signedIn} />),
  );
}

async function answer(ids: string[], result: unknown) {
  await act(async () => answers.get(pathFor(ids))?.(result));
}

const reads = () => vi.mocked(apiRequest).mock.calls.map(([, path]) => path);

describe('useAskableAtEvent', () => {
  it('returns the answer for the rows it was asked about', async () => {
    await show(PAU);
    expect(shown).toEqual({});
    await answer(PAU, { ok: true, data: { 'p-paul': 'g-paul' } });
    expect(shown).toEqual({ 'p-paul': 'g-paul' });
  });

  it('keeps the answer for "Pau" when the slower answer for "Pa" lands after it', async () => {
    await show(PA);
    await show(PAU);
    await answer(PAU, { ok: true, data: { 'p-paul': 'g-paul' } });
    await answer(PA, { ok: true, data: { 'p-pablo': 'g-pablo', 'p-paul': 'g-paul' } });
    expect(shown).toEqual({ 'p-paul': 'g-paul' });
  });

  it('shows nothing on the new rows while only the answer for the old ones has landed', async () => {
    await show(PA);
    await show(PAU);
    await answer(PA, { ok: true, data: { 'p-pablo': 'g-pablo' } });
    expect(shown).toEqual({});
  });

  it('shows nothing on the new rows until their own answer lands', async () => {
    await show(PA);
    await answer(PA, { ok: true, data: { 'p-paul': 'g-paul' } });
    await show(PAU);
    expect(shown).toEqual({});
    await answer(PAU, { ok: true, data: { 'p-paul': 'g-paul' } });
    expect(shown).toEqual({ 'p-paul': 'g-paul' });
  });

  it('aborts the read for the old rows when the rows change', async () => {
    await show(PA);
    const first = vi.mocked(apiRequest).mock.calls[0]?.[2]?.signal;
    await show(PAU);
    expect(first?.aborted).toBe(true);
  });

  it('reads once when the page re-renders with an equal new list', async () => {
    await show(PAU);
    await show(PAU);
    await show(PAU);
    expect(reads()).toEqual([pathFor(PAU)]);
  });

  it.each([
    ['an empty list', [], EVENT, true],
    ['no Event', PAU, null, true],
    ['a visitor who is not signed in', PAU, EVENT, false],
  ] as const)('reads nothing for %s', async (_label, ids, eventId, signedIn) => {
    await show([...ids], eventId, signedIn);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(shown).toEqual({});
  });

  it.each([
    ['a 403', { ok: false, kind: 'unauthenticated', status: 403 }],
    ['a 401', { ok: false, kind: 'unauthenticated', status: 401 }],
    ['a failure', { ok: false, kind: 'network' }],
    ['a bad shape', { ok: true, data: ['p-paul'] }],
  ])('returns nothing on %s', async (_label, result) => {
    await show(PAU);
    await answer(PAU, result);
    expect(shown).toEqual({});
  });

  it('forgets an earlier answer for the same rows when the new read for them fails', async () => {
    await show(PAU);
    await answer(PAU, { ok: true, data: { 'p-paul': 'g-paul' } });
    await show(PA);
    await show(PAU);
    await answer(PAU, { ok: false, kind: 'unauthenticated', status: 403 });
    expect(shown).toEqual({});
  });
});
