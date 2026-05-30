import { tintBgClassFor, tintTextClassFor } from '@myclash/ui';

/**
 * Compute the Tailwind className for a slot button in the Assignments grid.
 *
 *   - error → red, regardless of skill (operator must see something is wrong)
 *   - proposal → dashed indigo border + indigo tint, regardless of skill
 *     (engine output not yet persisted; operator must see what's saved
 *     vs what's only a preview suggestion)
 *   - assigned → tint with the skill's own colour token
 *   - unassigned → neutral gray
 */
export function assignmentChipClasses({
  hasAssignment,
  isError,
  isProposal,
  skillColor,
}: {
  hasAssignment: boolean;
  isError: boolean;
  isProposal?: boolean;
  skillColor: string | null | undefined;
}): string {
  if (isError) {
    return 'border-red-200 bg-red-50 text-red-900';
  }
  if (hasAssignment && isProposal) {
    return 'border-dashed border-indigo-400 bg-indigo-50 text-indigo-900';
  }
  if (hasAssignment) {
    return `border-transparent ${tintBgClassFor(skillColor)} ${tintTextClassFor(skillColor)}`;
  }
  return 'border-gray-200 bg-white text-gray-600 hover:border-gray-300';
}
