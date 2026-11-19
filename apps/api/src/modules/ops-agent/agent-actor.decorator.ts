import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { agentUserIdOf } from './agent-key.guard';

/**
 * The ops agent's own account on a door route: the actor of an action's audit row (the ops agent's
 * design, section 2). The door's guard sets it; a request it never passed throws.
 */
export const AgentActor = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  agentUserIdOf(context.switchToHttp().getRequest<FastifyRequest>()),
);
