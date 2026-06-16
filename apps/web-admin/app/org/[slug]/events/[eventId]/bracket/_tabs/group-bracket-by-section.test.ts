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
    expect(sections.map((s) => s.label)).toEqual([
      'Play-ins',
      'Round of 16',
      'Quarter-finals',
      'Semi-finals',
      'Final',
    ]);
  });

  it('groups several matches of the same round together', () => {
    const sections = groupBracketPoolsBySection([
      pool('LSW-B-QF-M1'),
      pool('LSW-B-QF-M2'),
      pool('LSW-B-SF-M1'),
    ]);
    const qf = sections.find((s) => s.label === 'Quarter-finals')!;
    expect(qf.pools).toHaveLength(2);
    expect(sections.find((s) => s.label === 'Semi-finals')!.pools).toHaveLength(1);
  });

  it('drops unparseable round codes into a trailing "Other" group', () => {
    const sections = groupBracketPoolsBySection([pool('LSW-B-QF-M1'), pool('weird-code')]);
    expect(sections[0]!.label).toBe('Quarter-finals');
    expect(sections[sections.length - 1]!.label).toBe('Other');
  });
});
