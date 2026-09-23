import { BadRequestException } from '@nestjs/common';
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

/**
 * The current version string of a penalty ruleset an Event of `organizationId`
 * may pin — recorded as the penalty_ruleset_version pin on a tournament/event at
 * assign time, so the content-hash reads the frozen snapshot for the version
 * that was pinned rather than whatever the live parent later becomes.
 *
 * The one owner of the four pin doors' check (operator rulings 64 and 66): the
 * built-in, a shared ruleset, or one that organisation owns. A Tournament's
 * ruleset is readable by every member of its organisation, so pinning another
 * organisation's private ruleset would hand its rules over. A missing ruleset
 * gets the same 400 as a foreign private one, so the answer names no ids, and a
 * failed read refuses rather than pinning no version.
 */
export async function loadPinnablePenaltyRulesetVersion(
  supabase: SupabaseService,
  rulesetId: string,
  organizationId: string,
): Promise<string | null> {
  const pinnable = await pinnablePenaltyRuleset(supabase, rulesetId, organizationId);
  if (!pinnable) {
    throw new BadRequestException('This penalty ruleset is not available to this organisation');
  }
  return pinnable.version;
}

/**
 * The rule itself, for a caller that decides what a refusal does: `null` when
 * an Event of `organizationId` may not pin the ruleset (missing, or another
 * organisation's private one). An archive restore clears such a pin instead of
 * refusing (operator ruling 67). A failed read throws: it is not a verdict.
 */
export async function pinnablePenaltyRuleset(
  supabase: SupabaseService,
  rulesetId: string,
  organizationId: string,
): Promise<{ version: string | null } | null> {
  const { data, error } = await supabase.service
    .from('penalty_rulesets')
    .select('version, built_in, public_visibility, owner_organization_id')
    .eq('id', rulesetId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const ruleset = data as {
    version?: string | null;
    built_in?: boolean;
    public_visibility?: boolean;
    owner_organization_id?: string | null;
  } | null;
  const pinnable =
    ruleset &&
    (ruleset.built_in ||
      ruleset.public_visibility ||
      ruleset.owner_organization_id === organizationId);
  return pinnable ? { version: ruleset.version ?? null } : null;
}
