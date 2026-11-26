import { NotFoundException } from '@nestjs/common';
import type { McpRefusal, McpToolDeps } from '../mcp-server';

type Dashboard = Awaited<ReturnType<McpToolDeps['fighters']['getMyDashboard']>>;

/**
 * The person's own dashboard, or the refusal of an account with no claimed fighter profile. Any
 * NotFoundException that escapes getMyDashboard becomes that refusal: that is right only because
 * the dashboard's other reads (HEMA Ratings, placements) swallow their own NotFound
 * (fighters.service.ts). If one stops doing so, a missing rating would tell a fighter they have no
 * profile. Any other error propagates, so a database failure is never that refusal.
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
