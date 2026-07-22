/**
 * apps/api/src/common/organization-names.ts
 *
 * Batch-resolve organization ids → display names. Extracted so the ruleset
 * catalog endpoints (scoring + penalty Discover tabs) resolve the "Shared by
 * {Org}" attribution the same way, and never render a raw UUID in the UI.
 *
 * Returns a Map so callers can look each id up without an inner loop; ids with
 * no matching row (deleted org) are simply absent from the map — the caller
 * decides the fallback label.
 */
import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../modules/supabase/supabase.service';

export async function resolveOrganizationNames(
  supabase: SupabaseService,
  orgIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(orgIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return map;

  const { data, error } = await supabase.service
    .from('organizations')
    .select('id, name')
    .in('id', ids);
  if (error) throw new BadRequestException(error.message);

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    map.set(row['id'] as string, row['name'] as string);
  }
  return map;
}
