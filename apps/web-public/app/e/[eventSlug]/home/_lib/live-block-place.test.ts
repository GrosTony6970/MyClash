import { describe, expect, it } from 'vitest';
import { liveBlockPlace } from './live-block-place';

/** While the Event runs, "Live now" is under the header (quick win F6). */
describe('where the Event home draws "Live now"', () => {
  it('under the header while the Event runs', () => {
    expect(liveBlockPlace('running')).toBe('top');
  });

  it.each(['published', 'draft', 'archived', ''])('after the lists for a %j Event', (status) => {
    expect(liveBlockPlace(status)).toBe('bottom');
  });

  it('nowhere once the Event is over', () => {
    expect(liveBlockPlace('completed')).toBe('none');
  });
});
