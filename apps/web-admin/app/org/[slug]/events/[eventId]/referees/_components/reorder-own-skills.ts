/**
 * The new order of this Event's own custom skills after a drag, or null when
 * the drag moves nothing. Built-in skills are shared by every club and keep
 * the platform's order: the server refuses a list holding one (operator ruling
 * 104b), so a built-in is neither dragged nor a drop target.
 */
export function reorderOwnSkills(
  skills: readonly { id: string; isSystem: boolean }[],
  dragId: string,
  targetId: string,
): string[] | null {
  const ids = skills.filter((skill) => !skill.isSystem).map((skill) => skill.id);
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}
