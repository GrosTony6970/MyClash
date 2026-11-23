import type { AdminFeatureFlagsService } from '../../modules/admin/admin-feature-flags.service';

/**
 * The platform clock a service reads (`AdminFeatureFlagsService.platformNow`), for tests:
 * real time (fake timers included) when no instant is given, else that instant — a super admin's
 * time simulation, without the flag row.
 */
export function platformClock(at?: Date): AdminFeatureFlagsService {
  return { platformNow: async () => at ?? new Date() } as unknown as AdminFeatureFlagsService;
}
