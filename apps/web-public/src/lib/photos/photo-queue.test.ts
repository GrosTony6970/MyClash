import { describe, expect, it } from 'vitest';
import {
  keepsSending,
  nextWaiting,
  removed,
  retried,
  withState,
  type QueueItem,
} from './photo-queue';

const item = (key: number, state: QueueItem['state']): QueueItem => ({
  key,
  file: { name: `${key}.jpg` } as File,
  state,
  progress: 0,
  message: null,
  sent: null,
});

describe('the photos waiting to be sent', () => {
  it('are sent in the order they were picked', () => {
    const items = [item(1, 'sent'), item(2, 'waiting'), item(3, 'waiting')];
    expect(nextWaiting(items)?.key).toBe(2);
    expect(nextWaiting([item(1, 'sent'), item(2, 'failed')])).toBeNull();
  });

  it('a photo retried while the queue runs is sent in that run, after the ones before it', () => {
    let items = [item(1, 'failed'), item(2, 'sending'), item(3, 'waiting')];
    items = retried(items, 1);
    expect(items.map((i) => i.state)).toEqual(['waiting', 'sending', 'waiting']);
    items = withState(items, 2, { state: 'sent', sent: 'approved' });
    expect(nextWaiting(items)?.key).toBe(1);
  });

  it('a retry clears the old reason and the old progress', () => {
    const failed = { ...item(1, 'failed'), message: 'No network.', progress: 0.4 };
    expect(retried([failed], 1)[0]).toMatchObject({ state: 'waiting', message: null, progress: 0 });
  });

  it('only a failed photo can be retried', () => {
    const items = [item(1, 'sent'), item(2, 'refused'), item(3, 'sending')];
    expect(retried(items, 1)).toEqual(items);
    expect(retried(items, 2)).toEqual(items);
    expect(retried(items, 3)).toEqual(items);
  });

  it('the photo being sent, or waiting out a busy answer, cannot be removed', () => {
    const items = [item(1, 'sending'), item(2, 'busy'), item(3, 'failed'), item(4, 'waiting')];
    expect(removed(items, 1)).toEqual(items);
    expect(removed(items, 2)).toEqual(items);
    expect(removed(removed(items, 3), 4).map((i) => i.key)).toEqual([1, 2]);
  });

  it('a change reaches only its own photo', () => {
    const items = [item(1, 'waiting'), item(2, 'waiting')];
    const next = withState(items, 2, { state: 'sending', progress: 0.5 });
    expect(next[0]).toBe(items[0]);
    expect(next[1]).toMatchObject({ key: 2, state: 'sending', progress: 0.5 });
  });
});

describe('after a send', () => {
  it('the next photo goes after a success or a refusal of the photo alone, never after the others', () => {
    expect(keepsSending('sent')).toBe(true);
    expect(keepsSending('photo')).toBe(true);
    expect(keepsSending('stop')).toBe(false);
    expect(keepsSending('closed')).toBe(false);
  });
});
