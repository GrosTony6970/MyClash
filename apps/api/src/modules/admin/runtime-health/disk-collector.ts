import type { AdminSystemActionsService, DiskUsageResult } from '../system-actions.service';

export function collectDisk(systemActions: AdminSystemActionsService): Promise<DiskUsageResult> {
  return systemActions.getDiskUsage();
}
