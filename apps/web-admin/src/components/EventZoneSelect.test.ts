import { describe, expect, it } from 'vitest';
import { COMMON_EVENT_ZONES, eventZoneOptions } from './EventZoneSelect';

describe('eventZoneOptions', () => {
  it('offers the common zones, the held one first and once', () => {
    expect(eventZoneOptions('Europe/Paris')).toEqual([...COMMON_EVENT_ZONES]);
    expect(eventZoneOptions('America/New_York')[0]).toBe('America/New_York');
    expect(eventZoneOptions('America/New_York')).toHaveLength(COMMON_EVENT_ZONES.length);
  });

  it('shows a held zone outside the list as itself', () => {
    expect(eventZoneOptions('Asia/Tokyo')).toEqual(['Asia/Tokyo', ...COMMON_EVENT_ZONES]);
  });
});
