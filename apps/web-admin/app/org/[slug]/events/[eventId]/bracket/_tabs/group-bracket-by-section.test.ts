import { describe, expect, it } from 'vitest';
import { groupBracketPoolsBySection } from './group-bracket-by-section';

const pool = (name: string) => ({ name });

describe('groupBracketPoolsBySection', () => {
  it('orders sections play-ins → round-of-N → QF → SF → Final', () => {
    const sections = groupBracketPoolsBySection([
      pool('LSW-B-F-M1'),
      pool('LSW-B-QF-M1'),
      pool('LSW-B-PI-M1'),
      pool('LSW-B-SF-M1'),
      pool('LSW-B-R16-M1'),
    ]);
    expect(sections.map((s) => s.token)).toEqual(['PI', 'R16', 'QF', 'SF', 'F']);
  });

  it('groups several matches of the same round together', () => {
    const sections = groupBracketPoolsBySection([
      pool('LSW-B-QF-M1'),
      pool('LSW-B-QF-M2'),
      pool('LSW-B-SF-M1'),
    ]);
    expect(sections.find((s) => s.token === 'QF')!.pools).toHaveLength(2);
    expect(sections.find((s) => s.token === 'SF')!.pools).toHaveLength(1);
  });

  it('drops unparseable round codes into a trailing group with no token', () => {
    const sections = groupBracketPoolsBySection([pool('LSW-B-QF-M1'), pool('weird-code')]);
    expect(sections[0]!.token).toBe('QF');
    expect(sections[sections.length - 1]!.token).toBeNull();
  });
});
