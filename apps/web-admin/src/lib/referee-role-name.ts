/**
 * A referee role as a person reads it: the Event's own name of the skill, the word of a
 * built-in role, or "Role removed" when neither is known (a custom skill deleted since).
 * Never its id (ruled 2026-10-15). A role IS a `referee_skills.id`.
 */
const BUILT_IN = new Set(['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table']);

type Translate = (key: string) => string;
/** The Event's names of its skills, as a Map or a plain object (the compensation pages). */
type SkillNames = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

function nameOf(names: SkillNames | undefined, role: string): string | undefined {
  if (!names) return undefined;
  return names instanceof Map ? names.get(role) : (names as Record<string, string>)[role];
}

export function refereeRoleName(role: string, t: Translate, skillNameById?: SkillNames): string {
  const skill = nameOf(skillNameById, role)?.trim();
  if (skill) return skill;
  if (BUILT_IN.has(role)) return t(`organizer.eventCompensation.roles.${role}`);
  return t('organizer.refereesPage.roleRemoved');
}

/** A slot of a board: the name the organiser typed for it, then its role's. */
export function slotRoleName(
  slot: { displayName?: string | null; role: string },
  t: Translate,
  skillNameById?: SkillNames,
): string {
  return slot.displayName || refereeRoleName(slot.role, t, skillNameById);
}
