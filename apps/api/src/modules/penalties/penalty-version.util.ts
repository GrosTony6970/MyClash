import type { PenaltyCard } from '@myclash/rulesets';
import type { SupabaseService } from '../supabase/supabase.service';

type Row = Record<string, unknown>;

/** One penalty_ruleset_entries row as serialised into a version snapshot. */
export interface PenaltyVersionEntry {
  groupNumber: number;
  refNumber: string;
  shortName: string;
  description: string;
  sanctions: PenaltyCard[];
  sortOrder: number;
}

/** Map DB entry rows to the ordered snapshot-array shape (camelCase, sorted). */
export function serializePenaltyEntries(rows: Row[]): PenaltyVersionEntry[] {
  return rows
    .slice()
    .sort((a, b) => Number(a['sort_order'] ?? 0) - Number(b['sort_order'] ?? 0))
    .map((entry, index) => ({
      groupNumber: Number(entry['group_number']),
      refNumber: String(entry['ref_number']),
      shortName: String(entry['short_name']),
      description: String(entry['description'] ?? ''),
      sanctions: (entry['sanctions'] as PenaltyCard[]) ?? [],
      sortOrder: Number(entry['sort_order'] ?? index + 1),
    }));
}

/**
 * Build the penalty_ruleset_versions insert payload from a `*, entries(*)` row.
 * Shared by publish() (snapshot only) and the pin-time freeze (which adds
 * is_frozen). `actorUserId` is normalised to null for the anonymous/unknown
 * sentinels.
 */
export function buildPenaltyVersionRow(
  ruleset: Row,
  actorUserId?: string,
): Record<string, unknown> {
  const actor =
    actorUserId && actorUserId !== 'unknown' && actorUserId !== 'anonymous' ? actorUserId : null;
  return {
    penalty_ruleset_id: ruleset['id'],
    version: ruleset['version'],
    name: ruleset['name'],
    description: ruleset['description'] ?? null,
    accumulation_scope: ruleset['accumulation_scope'],
    yellow_card_points: ruleset['yellow_card_points'],
    red_card_points: ruleset['red_card_points'],
    black_card_points: ruleset['black_card_points'],
    first_black_card_forfeit: ruleset['first_black_card_forfeit'],
    second_black_card_forfeit: ruleset['second_black_card_forfeit'],
    entries: serializePenaltyEntries(
      (ruleset['penalty_ruleset_entries'] as Row[] | undefined) ?? [],
    ),
    published_by_user_id: actor,
  };
}

/**
 * Snapshot the current version of a penalty ruleset (if not already) and mark it
 * frozen. Called when a tournament/event pins the ruleset, so the exact pinned
 * definition is captured immutably (the content-hash slice fingerprints it, and
 * the in-service edit-guard already refuses edits once referenced).
 *
 * No-op for the built-in (super-admin-managed) and best-effort: a snapshot
 * hiccup must never fail tournament creation, because immutability is enforced
 * by the edit-guard, not by this record. Mirrors events.freezeRulesetVersion,
 * except a penalty ruleset may be pinned before it was ever published, so this
 * must create the snapshot if it is missing rather than only flip a flag.
 */
export async function freezePenaltyRulesetVersion(
  supabase: SupabaseService,
  rulesetId: string,
  actorUserId?: string,
): Promise<void> {
  const { data } = await supabase.service
    .from('penalty_rulesets')
    .select('*, penalty_ruleset_entries(*)')
    .eq('id', rulesetId)
    .maybeSingle();
  const ruleset = data as Row | null;
  if (!ruleset || ruleset['built_in']) return;

  const { error } = await supabase.service
    .from('penalty_ruleset_versions')
    .insert({ ...buildPenaltyVersionRow(ruleset, actorUserId), is_frozen: true });
  if (error && /unique|duplicate/i.test(error.message)) {
    // Already snapshotted (e.g. via publish) — just flip the freeze flag.
    await supabase.service
      .from('penalty_ruleset_versions')
      .update({ is_frozen: true })
      .eq('penalty_ruleset_id', rulesetId)
      .eq('version', ruleset['version']);
  }
}
