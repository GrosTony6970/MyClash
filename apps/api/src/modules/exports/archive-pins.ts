import { pinnableCompensationPlan } from '../compensation/compensation-plan-pin';
import { pinnablePenaltyRuleset } from '../penalties/penalty-version.util';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ArchiveTables } from './archive.types';

/** What a restore cleared because the target organisation may not use it. */
export interface DroppedPins {
  droppedPenaltyRulesetPins: number;
  droppedCompensationPlans: number;
}

/**
 * A restore is a pin door for organisation-level definitions. An archive is a
 * file anyone can edit, so a pin in it can name any organisation's private
 * penalty ruleset or compensation plan; and an honest restore into another
 * organisation carries the source organisation's own pins, decided by the
 * archive's own organisation id. Either way the target organisation would read
 * another's private definitions through the restored Event. So both are held
 * to the rule the other doors use, before anything is inserted, and the counts
 * come back so the page can tell the organiser. A failed read fails the
 * restore: it is not a verdict.
 */
export async function dropRestoredPins(
  supabase: SupabaseService,
  data: ArchiveTables,
  organizationId: string,
): Promise<DroppedPins> {
  return {
    droppedPenaltyRulesetPins: await dropUnpinnablePenaltyPins(supabase, data, organizationId),
    droppedCompensationPlans: await dropUnusableCompensationSettings(
      supabase,
      data,
      organizationId,
    ),
  };
}

/**
 * Clears every restored Event and Tournament penalty ruleset pin the target
 * organisation may not pin (operator ruling 67). A cleared pin falls back to
 * the Event default or the built-in; the restore goes on.
 */
async function dropUnpinnablePenaltyPins(
  supabase: SupabaseService,
  data: ArchiveTables,
  organizationId: string,
): Promise<number> {
  const verdicts = new Map<string, boolean>();
  let dropped = 0;
  for (const row of [...data.events, ...data.tournaments]) {
    const rulesetId = row['penalty_ruleset_id'];
    if (typeof rulesetId !== 'string') continue;
    if (!verdicts.has(rulesetId)) {
      verdicts.set(
        rulesetId,
        Boolean(await pinnablePenaltyRuleset(supabase, rulesetId, organizationId)),
      );
    }
    if (verdicts.get(rulesetId)) continue;
    row['penalty_ruleset_id'] = null;
    row['penalty_ruleset_version'] = null;
    dropped += 1;
  }
  return dropped;
}

/**
 * Drops every restored Event compensation settings row whose plan the target
 * organisation may not use (operator ruling 69). Its `plan_id` is NOT NULL, so
 * the row goes, not the column: the restored Event has no compensation plan.
 */
async function dropUnusableCompensationSettings(
  supabase: SupabaseService,
  data: ArchiveTables,
  organizationId: string,
): Promise<number> {
  const kept = [];
  for (const row of data.refereeCompensationEventSettings) {
    const planId = row['plan_id'];
    if (
      typeof planId === 'string' &&
      (await pinnableCompensationPlan(supabase, planId, organizationId))
    ) {
      kept.push(row);
    }
  }
  const dropped = data.refereeCompensationEventSettings.length - kept.length;
  data.refereeCompensationEventSettings = kept;
  return dropped;
}
