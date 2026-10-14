import { describe, expect, it } from 'vitest';
import { phaseCrumb } from './phase-crumb';

/** O28: a bout's page leads back to its phase, on its own Tournament, on the right tab. */

const BASE = '/org/club/events/ev1';

describe('phaseCrumb', () => {
  it('sends a Pool bout to the bouts tab of the Pools page', () => {
    expect(phaseCrumb(BASE, 'pool', 't-2')).toEqual({
      href: `${BASE}/pools?tournamentId=t-2#matches`,
      label: 'organizer.matchDetail.crumbPools',
    });
  });

  it('sends a Swiss bout to the rounds tab', () => {
    expect(phaseCrumb(BASE, 'swiss', 't-2')?.href).toBe(`${BASE}/swiss?tournamentId=t-2#rounds`);
  });

  it('sends a bout of either elimination to the bracket', () => {
    for (const phase of ['single_elim', 'double_elim'] as const) {
      expect(phaseCrumb(BASE, phase, 't-2')).toEqual({
        href: `${BASE}/bracket?tournamentId=t-2#bracket`,
        label: 'organizer.matchDetail.crumbBracket',
      });
    }
  });

  it('draws no crumb for a bout whose phase is unknown', () => {
    expect(phaseCrumb(BASE, null, 't-2')).toBeNull();
  });
});
