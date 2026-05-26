import type { SupabaseService } from '../modules/supabase/supabase.service';

/**
 * Reads a feature-flag value via a direct supabase query, no DI dance.
 *
 * Why this exists: the canonical
 * `AdminFeatureFlagsService.isEnabled(key)` lives in `AdminModule`,
 * which already imports `HemaRatingsModule`, `MatchesModule`, etc. If
 * the gating site is in a module that AdminModule imports transitively
 * (or in `MailModule` which is `@Global()`), injecting the service
 * would create a circular module dependency. This helper sidesteps the
 * graph by hitting Supabase directly.
 *
 * Trade-off: no 5-second cache. Acceptable for kill-switches that flip
 * rarely and live on the slow path (cron processing, signup, outbound
 * email) — the extra single-row read is negligible. Hot paths should
 * keep using `AdminFeatureFlagsService.isEnabled` for the cache.
 *
 * Fails closed: if the lookup itself errors, return `false` so the
 * gated work proceeds. We never want a DB blip to flip a kill-switch
 * "on" by accident.
 */
export async function isFlagEnabledDirect(
  supabase: SupabaseService,
  key: string,
): Promise<boolean> {
  try {
    const { data } = await supabase.service
      .from('feature_flags')
      .select('enabled')
      .eq('key', key)
      .maybeSingle();
    return (data as { enabled?: boolean } | null)?.enabled === true;
  } catch {
    return false;
  }
}
