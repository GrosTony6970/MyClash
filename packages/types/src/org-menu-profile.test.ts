import { describe, expect, it } from 'vitest';
import { ORG_MENU_PROFILES, asOrgMenuProfile } from './org-menu-profile';

describe('organisation menu profile', () => {
  it('has exactly everything and workshops, the values of the column CHECK (0256)', () => {
    expect(ORG_MENU_PROFILES).toEqual(['everything', 'workshops']);
  });

  it('reads workshops as workshops', () => {
    expect(asOrgMenuProfile('workshops')).toBe('workshops');
  });

  it('reads everything, a missing value and an unknown value as everything', () => {
    expect(asOrgMenuProfile('everything')).toBe('everything');
    expect(asOrgMenuProfile(undefined)).toBe('everything');
    expect(asOrgMenuProfile(null)).toBe('everything');
    expect(asOrgMenuProfile('tournament')).toBe('everything');
  });
});
