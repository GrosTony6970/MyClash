import { describe, expect, it } from 'vitest';
import { assignmentChipClasses } from './assignment-chip-classes';

describe('assignmentChipClasses', () => {
  it('tints assigned chips with the skill colour token', () => {
    const orange = assignmentChipClasses({
      hasAssignment: true,
      isError: false,
      skillColor: 'orange',
    });
    expect(orange).toContain('bg-orange-50');
    expect(orange).toContain('text-orange-700');
  });

  it('uses a different tint per skill colour token', () => {
    const blue = assignmentChipClasses({ hasAssignment: true, isError: false, skillColor: 'blue' });
    expect(blue).toContain('bg-blue-50');
    expect(blue).not.toContain('bg-orange-50');
  });

  it('overrides skill colour with red when the slot is in an error state', () => {
    const result = assignmentChipClasses({
      hasAssignment: true,
      isError: true,
      skillColor: 'orange',
    });
    expect(result).toContain('bg-red-50');
    expect(result).not.toContain('bg-orange-50');
  });

  it('falls back to neutral gray when no assignment and no error', () => {
    const result = assignmentChipClasses({
      hasAssignment: false,
      isError: false,
      skillColor: 'orange',
    });
    expect(result).toContain('bg-white');
    expect(result).toContain('text-gray-600');
  });
});
