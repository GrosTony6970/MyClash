/**
 * apps/api/src/common/custom-ruleset-visibility.ts
 *
 * The single definition of "which custom_rulesets rows an organization can
 * see": its own, plus anything a super-admin approved for platform-wide
 * sharing, plus the system mirrors of the coded rulesets.
 *
 * Extracted because two call sites need it — the org catalog
 * (`CustomRulesetsService.listForOrg`, which feeds the authoring screens) and
 * the tournament ruleset picker (`SelectableRulesetsService`). Two hand-written
 * copies of a visibility predicate is precisely the shape that drifts into a
 * leak: widen one and the other silently keeps hiding rows, or vice versa.
 */

/**
 * PostgREST `.or()` filter string. Note `.or()` is combined with any sibling
 * `.eq()` by AND, so a caller can narrow this further (e.g. excluding
 * `is_system` rows) without rewriting the predicate.
 *
 * `orgId` is interpolated into a PostgREST filter expression, so it must be a
 * value the route already validated — every caller runs it through
 * `ParseUUIDPipe` or reads it off a database row.
 */
export function customRulesetOrgVisibilityFilter(orgId: string): string {
  return `is_system.eq.true,public_visibility.eq.true,owner_organization_id.eq.${orgId}`;
}
