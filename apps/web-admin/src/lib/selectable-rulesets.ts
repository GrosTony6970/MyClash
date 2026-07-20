/**
 * apps/web-admin/src/lib/selectable-rulesets.ts
 *
 * Fetch the rulesets a tournament in this event may be pointed at.
 *
 * `GET /rulesets` returns only the coded built-ins, so both tournament
 * pickers used to make an org-authored ruleset unselectable no matter how
 * far its author took it through authoring, publishing and sharing.
 * `for-event/:eventId` returns those built-ins plus the owning org's own and
 * publicly-shared rulesets — every one of them resolved server-side first, so
 * anything listed here is genuinely usable.
 */

export interface SelectableRuleset {
  code: string;
  version: string;
  label: string;
  /** False for the coded built-ins, true for an org-authored ruleset. */
  custom?: boolean;
}

/**
 * Falls back to the coded catalog when the event-scoped call fails.
 *
 * The endpoint requires org 'admin' — the same role tournament creation
 * requires — so a lower-privileged viewer gets a 403. They cannot save a
 * ruleset change anyway, and an empty picker would render the current
 * selection as blank, which reads as data loss. The built-ins keep the page
 * truthful.
 */
export async function fetchSelectableRulesets(
  apiUrl: string,
  eventId: string | undefined,
): Promise<SelectableRuleset[]> {
  if (eventId) {
    const scoped = await fetch(`${apiUrl}/api/v1/rulesets/for-event/${eventId}`, {
      credentials: 'include',
    }).catch(() => null);
    if (scoped?.ok) return (await scoped.json()) as SelectableRuleset[];
  }

  const coded = await fetch(`${apiUrl}/api/v1/rulesets`, { credentials: 'include' }).catch(
    () => null,
  );
  return coded?.ok ? ((await coded.json()) as SelectableRuleset[]) : [];
}
