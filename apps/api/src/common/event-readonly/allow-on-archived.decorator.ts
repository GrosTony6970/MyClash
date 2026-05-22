import { SetMetadata } from '@nestjs/common';

export const ALLOW_ON_ARCHIVED_EVENT_KEY = 'allow-on-archived-event';

/**
 * Marks a route handler (or controller) as exempt from EventReadOnlyGuard.
 * Used for deletion-request submission/cancellation and super-admin actions.
 */
export const AllowOnArchivedEvent = () => SetMetadata(ALLOW_ON_ARCHIVED_EVENT_KEY, true);
