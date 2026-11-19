import { describe, expect, it } from 'vitest';
import { printedAt } from './print-shell';

/**
 * Ruling 891: the "Generated" stamp read the printing machine's clock while the piste rows read
 * the event's. 16:00 UTC on 6 June 2026 is 18:00 in Paris and 12:00 in New York.
 */
describe('printedAt', () => {
  const now = new Date('2026-06-06T16:00:00.000Z');

  it("stamps the event's clock, whatever zone the printing machine is in", () => {
    expect(printedAt(now, 'Europe/Paris', 'fr-FR')).toContain('18:00');
    expect(printedAt(now, 'America/New_York', 'fr-FR')).toContain('12:00');
  });

  it('carries the date too', () => {
    expect(printedAt(now, 'Europe/Paris', 'fr-FR')).toContain('06/06/2026');
  });
});
