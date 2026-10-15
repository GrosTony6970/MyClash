/**
 * What a referee duty's role is called on a schedule: the name the organiser
 * gave it ("Table", "Assesseur", or a role of their own). The API sends that
 * name beside the role's id; the id (`arbitre_table`) is never shown. A duty
 * with no named role is a plain "Referee".
 *
 * The ONE wording for the signed-in schedule, the two guest pages (operator
 * ruling, 2026-10-13) and the Tournament page's Pool footers and bracket cards.
 */
export function refereeRoleLabel(
  skillName: string | null | undefined,
  t: (key: string) => string,
): string {
  return skillName || t('publicApp.me.events.roleReferee');
}
