import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AGENT_LOG_SERVICES } from '../agent-log-services';

/**
 * `GET /ops-agent/logs/:service`. Bound whole (`@Param() params: AgentLogParamDto`): a bare
 * `@Param('service') service: string` has the metatype `String`, which the global pipe hands to
 * class-validator, and that checks nothing (`matches.dto.ts`, the schedule DTO's note).
 */
const agentLogParamSchema = z.object({ service: z.enum(AGENT_LOG_SERVICES) }).strict();
export class AgentLogParamDto extends createZodDto(agentLogParamSchema) {}

/** The ops runner's caps (`infra/ops-runner/container-logs.mjs`): 1 to 500 lines, 100 by default. */
const agentLogQuerySchema = z
  .object({
    lines: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(500))
      .default(100),
    errors: z
      .enum(['0', '1', 'true', 'false'])
      .transform((value) => value === '1' || value === 'true')
      .default(false),
  })
  .strict();
export class AgentLogQueryDto extends createZodDto(agentLogQuerySchema) {}

export interface AgentLogDto {
  generatedAt: string;
  service: string;
  lines: string[];
  truncated: boolean;
}
