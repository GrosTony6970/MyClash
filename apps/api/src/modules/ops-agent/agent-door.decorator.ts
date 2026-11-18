import { applyDecorators, UseGuards } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { AgentKeyGuard } from './agent-key.guard';

/**
 * Marks a controller as the ops agent's door (the ops agent's design, section 2).
 *
 * `@Public()` tells the global AuthGuard not to ask for a login: the ops agent has none. The
 * door's own guard then asks for the agent key, and refuses everyone without it. The two never
 * appear apart — `agent-door.wall.test.ts` holds that this file joins them, and
 * `public-routes.test.ts` holds that every door route carries the guard.
 *
 * The route scanner (`route-authz-scan.ts`) reads this decorator by name and gives its routes the
 * verdict `agent-door`.
 */
export function AgentDoor(): ClassDecorator {
  return applyDecorators(Public(), UseGuards(AgentKeyGuard));
}
