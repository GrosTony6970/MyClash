import { pinnablePenaltyRuleset } from '../penalties/penalty-version.util';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ArchiveTables } from './archive.types';

/**
 * Clears every restored Event and Tournament pin that an Event of
 * `organizationId` may not pin, and says how many it cleared (operator ruling
 * 67).
 *
 * A restore is a fifth pin door. An archive is a file anyone can edit, so a
 * pin in it can name any organisation's private penalty ruleset; and an honest
 * restore into another organisation carries the source organisation's own
 * pins. Either way the target organisation's members would read those rules
 * through the restored Tournament. The rule is `pinnablePenaltyRuleset`'s, the
 * one the other four doors use. A cleared pin falls back to the Event default
 * or the built-in; the restore goes on, and the count comes back so the page
 * can tell the organiser. A failed read fails the restore: it is not a verdict.
 */
export async function dropUnpinnablePenaltyPins(
  supabase: SupabaseService,
  data: ArchiveTables,
  organizationId: string,
): Promise<number> {
  const verdicts = new Map<string, Promise<boolean>>();
  let dropped = 0;
  for (const row of [...data.events, ...data.tournaments]) {
    const rulesetId = row['penalty_ruleset_id'];
    if (typeof rulesetId !== 'string') continue;
    if (!verdicts.has(rulesetId)) {
      verdicts.set(
        rulesetId,
        pinnablePenaltyRuleset(supabase, rulesetId, organizationId).then(Boolean),
      );
    }
    if (await verdicts.get(rulesetId)) continue;
    row['penalty_ruleset_id'] = null;
    row['penalty_ruleset_version'] = null;
    dropped += 1;
  }
  return dropped;
}
