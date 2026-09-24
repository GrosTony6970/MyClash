import { describe, expect, it } from 'vitest';
import { boutPoll } from './bout-poll';
import { mapMatchRow } from './match-row';

/**
 * The spectator bout page's poll (ruling 92). Its live channel is anonymous and
 * RLS keeps a hidden bout's rows off it, so a club member watching a draft
 * Event's bout saw the score stop at the first picture: the channel said
 * SUBSCRIBED and never spoke again.
 */
const base = {
  isFinal: false,
  degraded: false,
  visible: true,
  channelStatus: 'SUBSCRIBED',
  match: { status: 'running', hiddenFromPublic: false },
};

describe('boutPoll', () => {
  it('does not poll a public bout while its channel is up', () => {
    expect(boutPoll(base)).toEqual({ pollMs: null, channelStatus: 'SUBSCRIBED' });
  });

  it('polls a dropped channel at the fallback cadence, and the chip reads the channel', () => {
    const dropped = { ...base, degraded: true, channelStatus: 'CLOSED' };
    expect(boutPoll(dropped)).toEqual({ pollMs: 5_000, channelStatus: 'CLOSED' });
    const scheduled = { ...dropped, match: { status: 'scheduled', hiddenFromPublic: false } };
    expect(boutPoll(scheduled).pollMs).toBe(30_000);
    expect(boutPoll({ ...dropped, visible: false }).pollMs).toBe(30_000);
  });

  it('polls a hidden bout under a SUBSCRIBED channel, and the chip hears the poll', () => {
    const hidden = { ...base, match: { status: 'running', hiddenFromPublic: true } };
    expect(boutPoll(hidden)).toEqual({ pollMs: 5_000, channelStatus: null });
    // Same cadence as the page's fallback: a scheduled bout slowly, a hidden tab slowly.
    const waiting = { ...hidden, match: { status: 'scheduled', hiddenFromPublic: true } };
    expect(boutPoll(waiting)).toEqual({ pollMs: 30_000, channelStatus: null });
    expect(boutPoll({ ...hidden, visible: false }).pollMs).toBe(30_000);
  });

  it('keeps the dropped channel on the chip when a hidden bout also loses its channel', () => {
    const both = {
      ...base,
      degraded: true,
      channelStatus: 'CHANNEL_ERROR',
      match: { status: 'running', hiddenFromPublic: true },
    };
    expect(boutPoll(both)).toEqual({ pollMs: 5_000, channelStatus: 'CHANNEL_ERROR' });
  });

  it('stops polling a hidden bout once the poll reads it finished', () => {
    for (const status of ['completed', 'voided']) {
      const ended = { ...base, match: { status, hiddenFromPublic: true } };
      expect(boutPoll(ended), status).toEqual({ pollMs: null, channelStatus: 'SUBSCRIBED' });
    }
  });

  it('never polls a bout that was finished when the page loaded', () => {
    const final = { ...base, isFinal: true, degraded: true, channelStatus: 'CLOSED' };
    expect(boutPoll(final).pollMs).toBeNull();
    const hidden = { ...base, isFinal: true, match: { status: 'running', hiddenFromPublic: true } };
    expect(boutPoll(hidden).pollMs).toBeNull();
  });
});

describe('mapMatchRow carries the bout read’s hidden mark', () => {
  it('reads the flag from the bout read', () => {
    expect(mapMatchRow({ id: 'm', hiddenFromPublic: true }).hiddenFromPublic).toBe(true);
    expect(mapMatchRow({ id: 'm', hiddenFromPublic: false }).hiddenFromPublic).toBe(false);
  });

  // A push on the public channel is proof the public can see the bout.
  it('reads a realtime row, which never carries it, as public', () => {
    expect(mapMatchRow({ id: 'm', status: 'running' }).hiddenFromPublic).toBe(false);
  });
});
