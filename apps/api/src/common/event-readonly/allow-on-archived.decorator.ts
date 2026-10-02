import { SetMetadata } from '@nestjs/common';

export const ALLOW_ON_ARCHIVED_EVENT_KEY = 'allow-on-archived-event';

/**
 * Marks a route handler (or controller) as exempt from EventReadOnlyGuard.
 * Each use names its reason: a deletion request, a super admin's answer, a
 * rating, a score correction (as on a completed Event), a roster edit, a
 * League link. `archived-lock.routes.test.ts` pins the whole set.
 */
export const AllowOnArchivedEvent = () => SetMetadata(ALLOW_ON_ARCHIVED_EVENT_KEY, true);
