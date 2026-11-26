import { NotFoundException } from '@nestjs/common';
import type { McpRefusal, McpToolDeps } from '../mcp-server';

type Dashboard = Awaited<ReturnType<McpToolDeps['fighters']['getMyDashboard']>>;

/**
 * The person's own dashboard, or the refusal of an account with no claimed fighter profile. Only
 * the profile's own NotFound is that refusal: any other error propagates, so a database failure
 * never tells a fighter they have no profile.
 */
export async function ownDashboard(
  userId: string,
  deps: McpToolDeps,
): Promise<Dashboard | McpRefusal> {
  try {
    return await deps.fighters.getMyDashboard(userId);
  } catch (error) {
    if (error instanceof NotFoundException) return { refusal: 'You have no fighter profile yet.' };
    throw error;
  }
}

export function isRefusal(value: Dashboard | McpRefusal): value is McpRefusal {
  return 'refusal' in value && typeof value.refusal === 'string';
}
