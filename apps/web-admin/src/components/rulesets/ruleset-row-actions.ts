/**
 * Which row actions a scoring/penalty ruleset row should offer, given its
 * origin. The rule, in one place so all rulesets tabs agree:
 *
 *   • You can always **clone** any ruleset into your own org.
 *   • You can **edit / delete** only rulesets your org owns.
 *   • Anything you can't edit (built-ins, other orgs' shared rulesets) you can
 *     still **view** read-only.
 *
 * Page-specific actions (submit-for-review, submit-for-sharing) are layered on
 * top by each page; they are not part of this core rule.
 */
export interface RulesetRowOrigin {
  /** A platform/system built-in ruleset (is_system / built_in). */
  builtIn: boolean;
  /** Owned by the current org (owner_organization_id === orgId). */
  mine: boolean;
}

export interface RulesetRowActions {
  view: boolean;
  clone: boolean;
  edit: boolean;
  delete: boolean;
}

export function rulesetRowActions({ builtIn, mine }: RulesetRowOrigin): RulesetRowActions {
  const editable = mine && !builtIn;
  return {
    view: !editable,
    clone: true,
    edit: editable,
    delete: editable,
  };
}
