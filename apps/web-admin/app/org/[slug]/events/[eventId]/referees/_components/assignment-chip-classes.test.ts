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

  it('renders a dashed indigo style when the chip is a non-persisted proposal', () => {
    const result = assignmentChipClasses({
      hasAssignment: true,
      isError: false,
      isProposal: true,
      skillColor: 'orange',
    });
    expect(result).toContain('border-dashed');
    expect(result).toContain('border-indigo-400');
    expect(result).toContain('bg-indigo-50');
    // Proposal styling beats the skill tint — operator must see at a
    // glance that nothing's saved yet, regardless of role colour.
    expect(result).not.toContain('bg-orange-50');
  });

  it('error styling beats the proposal styling — broken state always wins', () => {
    const result = assignmentChipClasses({
      hasAssignment: true,
      isError: true,
      isProposal: true,
      skillColor: 'orange',
    });
    expect(result).toContain('bg-red-50');
    expect(result).not.toContain('border-dashed');
  });
});
