import { Logger } from '@nestjs/common';
import type { SupabaseService } from '../modules/supabase/supabase.service';

const logger = new Logger('FeatureFlagDirect');

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
 * Fails OPEN, on purpose (operator ruling 109a): if the lookup fails — a
 * returned `error` or a throw — it returns `false`, so the gated work
 * proceeds, and logs a warning naming the flag so the blip leaves a trace.
 * A kill switch is off almost always; reading a blip as "on" would drop a
 * sign-in email without a trace. The cached `isEnabled` answers the same.
 */
export async function isFlagEnabledDirect(
  supabase: SupabaseService,
  key: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.service
      .from('feature_flags')
      .select('enabled')
      .eq('key', key)
      .maybeSingle();
    if (error) {
      logger.warn(`flag ${key} read failed, treated as off: ${error.message}`);
      return false;
    }
    return (data as { enabled?: boolean } | null)?.enabled === true;
  } catch (err) {
    logger.warn(
      `flag ${key} read threw, treated as off: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
