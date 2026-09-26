import type { EmptySlotReason } from '@myclash/rulesets/scheduling';

/**
 * Why auto-assign left a slot empty, in words. The engine answers with its two seat rules
 * or with the one referee checker's codes (W1.3, ADR-016): each code refused at least one
 * qualified referee.
 *
 * A `switch` of literal `t()` calls: the i18n sweep resolves keys it can read at the call
 * site. An unknown code falls through to the raw code, so an untranslated new one shows
 * up in QA rather than as nothing.
 */
export function formatUnassignedReason(code: string, t: (key: string) => string): string {
  switch (code as EmptySlotReason) {
    case 'no_qualified_users':
      return t('organizer.refereesPage.unassignedReasons.no_qualified_users');
    case 'all_qualified_already_seated':
      return t('organizer.refereesPage.unassignedReasons.all_qualified_already_seated');
    case 'own_match':
      return t('organizer.refereesPage.unassignedReasons.own_match');
    case 'fights_overlap':
      return t('organizer.refereesPage.unassignedReasons.fights_overlap');
    case 'referees_overlap':
      return t('organizer.refereesPage.unassignedReasons.referees_overlap');
    case 'teaches_overlap':
      return t('organizer.refereesPage.unassignedReasons.teaches_overlap');
    case 'outside_availability':
      return t('organizer.refereesPage.unassignedReasons.outside_availability');
    case 'own_pool':
      return t('organizer.refereesPage.unassignedReasons.own_pool');
    case 'own_pool_span':
      return t('organizer.refereesPage.unassignedReasons.own_pool_span');
    case 'two_roles':
      return t('organizer.refereesPage.unassignedReasons.two_roles');
    case 'attends_overlap':
      return t('organizer.refereesPage.unassignedReasons.attends_overlap');
    case 'rest':
      return t('organizer.refereesPage.unassignedReasons.rest');
    case 'cap':
      return t('organizer.refereesPage.unassignedReasons.cap');
    default:
      return code;
  }
}
