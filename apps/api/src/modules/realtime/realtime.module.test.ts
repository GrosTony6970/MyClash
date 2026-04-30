import { describe, expect, it } from 'vitest';
import { Channels } from './channels';

describe('Channels', () => {
  it('matchExchanges returns correct channel name', () => {
    expect(Channels.matchExchanges('abc-123')).toBe('match:abc-123:exchanges');
  });

  it('matchClock returns correct channel name', () => {
    expect(Channels.matchClock('abc-123')).toBe('match:abc-123:clock');
  });

  it('liceCurrentMatch returns correct channel name', () => {
    expect(Channels.liceCurrentMatch('lice-1')).toBe('lice:lice-1:current');
  });

  it('event returns correct channel name', () => {
    expect(Channels.event('evt-99')).toBe('event:evt-99');
  });

  it('eventStandings returns correct channel name', () => {
    expect(Channels.eventStandings('evt-99')).toBe('event:evt-99:standings');
  });
});
