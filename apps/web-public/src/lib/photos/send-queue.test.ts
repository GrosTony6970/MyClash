import { describe, expect, it, vi } from 'vitest';
import { messages } from '@myclash/i18n/public';
import { createTranslator } from '@myclash/i18n/runtime';
import type { ApiResult } from '@myclash/api-client';
import type { QueueItem } from './photo-queue';
import { retried } from './photo-queue';
import type { PhotoFields, PhotoSent } from './send-photo';
import { pickedItems, sendQueued, type SendQueueDeps } from './send-queue';

const t = createTranslator(messages.en);

const fields = (name: string): PhotoFields => ({ name, caption: '', tag: null });
const waiting = (key: number, state: QueueItem['state'] = 'waiting'): QueueItem => ({
  key,
  file: { name: `${key}.jpg` } as File,
  state,
  progress: 0,
  message: null,
  sent: null,
});

type Result = ApiResult<PhotoSent>;
const sent: Result = { ok: true, data: { id: 'p', status: 'approved' } };
const http = (status: number, code: string | null): Result =>
  status === 403
    ? { ok: false, kind: 'unauthenticated', status, detail: 'x', code, details: null }
    : { ok: false, kind: 'http', status, detail: 'x', code, details: null, validationErrors: null };

/** A queue over a plain array, its sends answered in turn; `during` runs inside a send. */
function queue(start: QueueItem[], answers: Result[], during?: (send: number) => void) {
  let items = start;
  let current = fields('first');
  const calls: Array<{ key: number; name: string }> = [];
  const onClosed = vi.fn();
  const deps: SendQueueDeps = {
    items: () => items,
    update: (change) => {
      items = change(items);
    },
    fields: () => current,
    send: async (item, f) => {
      calls.push({ key: item.key, name: f.name });
      during?.(calls.length);
      return answers.shift() ?? sent;
    },
    t,
    onClosed,
  };
  return {
    deps,
    calls,
    onClosed,
    items: () => items,
    setFields: (f: PhotoFields) => {
      current = f;
    },
    change: (fn: (list: QueueItem[]) => QueueItem[]) => {
      items = fn(items);
    },
  };
}

const states = (items: readonly QueueItem[]) => items.map((item) => item.state);

describe('the send loop', () => {
  it('sends every waiting photo, one at a time, in pick order', async () => {
    const q = queue([waiting(1), waiting(2, 'sent'), waiting(3)], []);
    await sendQueued(q.deps);
    expect(q.calls.map((c) => c.key)).toEqual([1, 3]);
    expect(states(q.items())).toEqual(['sent', 'sent', 'sent']);
  });

  it('goes on after a photo refused for its own bytes, which gets no Retry', async () => {
    const q = queue([waiting(1), waiting(2)], [http(422, 'photo_corrupt')]);
    await sendQueued(q.deps);
    expect(q.calls.map((c) => c.key)).toEqual([1, 2]);
    expect(states(q.items())).toEqual(['refused', 'sent']);
    expect(q.items()[0]!.message).toBe(t('publicApp.photoSend.refusal.corrupt'));
  });

  it('stops after a passing failure: that photo fails with Retry, the rest wait', async () => {
    const q = queue([waiting(1), waiting(2)], [{ ok: false, kind: 'network' }]);
    await sendQueued(q.deps);
    expect(q.calls).toHaveLength(1);
    expect(states(q.items())).toEqual(['failed', 'waiting']);
    expect(q.onClosed).not.toHaveBeenCalled();
  });

  it('a closing refusal stops the run and closes the form once', async () => {
    const q = queue([waiting(1), waiting(2)], [http(403, 'photos_window_closed')]);
    await sendQueued(q.deps);
    expect(q.calls).toHaveLength(1);
    expect(q.onClosed.mock.calls).toEqual([[t('publicApp.photoSend.refusal.windowClosed')]]);
    expect(states(q.items())).toEqual(['failed', 'waiting']);
  });

  it('a photo retried during the run is sent in it, with the fields of that tap', async () => {
    const q = queue([waiting(1), waiting(2), waiting(3)], [http(422, 'photo_heic')], (send) => {
      if (send === 2) {
        q.setFields(fields('second'));
        // The HEIC was refused, so it is not retried; a failed one would be.
        q.change((list) => list.map((i) => (i.key === 1 ? { ...i, state: 'failed' } : i)));
        q.change((list) => retried(list, 1));
      }
    });
    await sendQueued(q.deps);
    expect(q.calls).toEqual([
      { key: 1, name: 'first' },
      { key: 2, name: 'first' },
      { key: 1, name: 'second' },
      { key: 3, name: 'second' },
    ]);
  });

  it('the page leaving ends the run, and nothing more is sent', async () => {
    const q = queue([waiting(1), waiting(2)], [{ ok: false, kind: 'aborted' }]);
    await sendQueued(q.deps);
    expect(q.calls).toHaveLength(1);
    expect(states(q.items())).toEqual(['sending', 'waiting']);
  });
});

describe('the photos picked', () => {
  const file = (name: string, size = 100) => ({ name, size }) as File;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it('are keyed in pick order, whichever read ends first', async () => {
    const reads = [30, 0, 10];
    const readHead = (f: File) =>
      new Promise<Uint8Array>((resolve) => setTimeout(() => resolve(JPEG), reads.shift()));
    const picked = await pickedItems([file('a'), file('b'), file('c')], 5, t, readHead);
    expect(picked.map((i) => [i.key, i.file.name, i.state])).toEqual([
      [5, 'a', 'waiting'],
      [6, 'b', 'waiting'],
      [7, 'c', 'waiting'],
    ]);
  });

  it('a file the phone cannot read gets its own row, and the others are kept', async () => {
    const readHead = async (f: File) => {
      if (f.name === 'cloud') throw new DOMException('Not readable', 'NotReadableError');
      return JPEG;
    };
    const picked = await pickedItems([file('a'), file('cloud'), file('c')], 1, t, readHead);
    expect(picked.map((i) => i.state)).toEqual(['waiting', 'refused', 'waiting']);
    expect(picked[1]!.message).toBe(t('publicApp.photoSend.unreadable'));
  });

  it('a photo the page refuses itself says why, before anything is sent', async () => {
    const heic = new Uint8Array([0, 0, 0, 0x18, ...[...'ftypheic'].map((c) => c.charCodeAt(0))]);
    const picked = await pickedItems([file('h')], 1, t, async () => heic);
    expect(picked[0]).toMatchObject({
      state: 'refused',
      message: t('publicApp.photoSend.refusal.heic'),
    });
  });
});
