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

/** State of a ruleset row as the super-admin catalogues see it. */
export interface AdminRulesetRowState {
  /** A platform built-in ruleset (built_in / is_system). */
  builtIn: boolean;
  /** Soft-archived: `archived_at` is set (mig 0153). */
  archived: boolean;
}

/** Row actions the super-admin catalogues offer. No `clone` — that lives org-side. */
export type AdminRulesetRowActions = Pick<RulesetRowActions, 'view' | 'edit' | 'delete'>;

/**
 * The super-admin variant of the rule above. Deliberately NOT `rulesetRowActions`:
 * that one keys off `mine`, which is meaningless for a super-admin who owns every
 * catalogue and *can* edit built-ins in place (see `builtInSuperAdminBanner`).
 * Routing this page through it would wrongly strip Edit from built-ins.
 *
 *   • **Archived ⇒ read-only.** A ruleset is only archived because something still
 *     referenced it, and `updateRuleset` refuses to PATCH any referenced non-builtin
 *     (`ForbiddenException`) — so offering Edit here is a 403 with extra steps.
 *     Delete is no better: it re-enters the archive branch and just re-stamps
 *     `archived_at`. View stays on, because tournaments that pinned this ruleset
 *     keep scoring by it forever and its sanctions must remain inspectable.
 *   • **Built-ins can be edited, never deleted** — matching the server, which
 *     exempts built_in from the reference guard but rejects deleting it outright.
 */
export function adminRulesetRowActions({
  builtIn,
  archived,
}: AdminRulesetRowState): AdminRulesetRowActions {
  if (archived) return { view: true, edit: false, delete: false };
  return { view: false, edit: true, delete: !builtIn };
}
