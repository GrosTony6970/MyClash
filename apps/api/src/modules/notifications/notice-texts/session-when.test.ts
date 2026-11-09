import { describe, expect, it } from 'vitest';
import { sessionWhen } from './session-when';

describe('when a session starts, as a notice says it', () => {
  it("says the start on the Event's clock, in each language", () => {
    // Saturday 14 November 2026, 13:00 UTC = 14:00 in Paris.
    expect(sessionWhen('2026-11-14T13:00:00Z', 'Europe/Paris')).toEqual({
      fr: 'sam. 14 nov., 14:00',
      en: 'Sat 14 Nov, 14:00',
    });
    expect(sessionWhen('2026-11-14T13:00:00Z', 'America/New_York')?.en).toBe('Sat 14 Nov, 08:00');
  });

  it('says nothing for a session with no start', () => {
    expect(sessionWhen(null, 'Europe/Paris')).toBeNull();
  });
});
