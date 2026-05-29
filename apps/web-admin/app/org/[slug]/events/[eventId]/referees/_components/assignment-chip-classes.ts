import { tintBgClassFor, tintTextClassFor } from '@myclash/ui';

/**
 * Compute the Tailwind className for a slot button in the Assignments grid.
 *
 *   - error → red, regardless of skill (operator must see something is wrong)
 *   - assigned → tint with the skill's own colour token
 *   - unassigned → neutral gray
 */
export function assignmentChipClasses({
  hasAssignment,
  isError,
  skillColor,
}: {
  hasAssignment: boolean;
  isError: boolean;
  skillColor: string | null | undefined;
}): string {
  if (isError) {
    return 'border-red-200 bg-red-50 text-red-900';
  }
  if (hasAssignment) {
    return `border-transparent ${tintBgClassFor(skillColor)} ${tintTextClassFor(skillColor)}`;
  }
  return 'border-gray-200 bg-white text-gray-600 hover:border-gray-300';
}
