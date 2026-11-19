import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RESTARTABLE_SERVICES } from '../../admin/system-actions.service';

/**
 * `POST /ops-agent/containers/:service/:action`. Bound whole (`@Param() params`): a bare
 * `@Param('x') x: string` checks nothing (`agent-logs.dto.ts`). Restart or start only, never stop
 * (the design, section 2); a service of the restartable list only.
 */
const agentContainerActionParamSchema = z
  .object({
    service: z.enum(RESTARTABLE_SERVICES),
    action: z.enum(['restart', 'start']),
  })
  .strict();
export class AgentContainerActionParamDto extends createZodDto(agentContainerActionParamSchema) {}

/** What the door answers of an action: no shell output, no error text. */
export interface AgentActionResultDto {
  ok: boolean;
  service: string;
  action: string;
  exitCode: number | null;
  timedOut: boolean;
  /** A renewal is answered before Traefik restarts: its result shows in the next `tls` read. */
  scheduled: boolean;
}

/** What the door answers of a backup it started: the operation to watch, never its shell lines. */
export interface AgentBackupStartedDto {
  operation: { id: string; kind: string; status: string; startedAt: string };
}
