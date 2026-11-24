import { applyDecorators, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConnectorDoor } from '../../common/auth/connector-door';
import { Public } from '../../common/auth/public.decorator';
import { ThrottleMcp } from '../../common/throttling/throttle-mcp';
import { McpDoorGuard } from './mcp-door.guard';

/**
 * Marks a controller as the MCP door: the one place a Claude connector token opens.
 *
 * `Public()` tells AuthGuard not to answer 401 itself: the door answers it, with the challenge
 * Claude reads to start the sign-in (`McpDoorGuard`). `ConnectorDoor()` lets a connector token
 * past AuthGuard's wall. The global per-IP throttle is off because every person's Claude calls
 * from Anthropic's few addresses; the door counts per account instead (`mcp`), and counts calls
 * with no login per address (`mcp-anon`, but not a validly signed token, even expired;
 * `ThrottleMcp`). They
 * never appear apart.
 *
 * The route scanner (`route-authz-scan.ts`) reads this decorator by name and gives its routes the
 * verdict `mcp-door`.
 */
export function McpDoor(): ClassDecorator {
  return applyDecorators(
    Public(),
    ConnectorDoor(),
    UseGuards(McpDoorGuard),
    SkipThrottle({ global: true }),
    ThrottleMcp(),
  );
}
