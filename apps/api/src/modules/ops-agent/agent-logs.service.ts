import { OpsRunnerClient, type OpsRunnerClientOptions } from '../admin/ops-runner-client';
import type { AgentLogService } from './agent-log-services';
import type { AgentContainerDto, AgentContainersDto, AgentLogDto } from './dto/agent-logs.dto';
import { scrubForAgent } from './scrub';

type Row = Record<string, unknown>;

/**
 * The ops agent's container reads, through the ops runner (`GET /containers`, `GET /logs/:name`,
 * `infra/ops-runner/container-logs.mjs`). The runner's JSON arrives untyped, so each answer is
 * built field by field; every log line passes `scrubForAgent` before the agent sees it.
 */
export class AgentLogsService {
  private readonly ops: OpsRunnerClient;

  constructor(options: OpsRunnerClientOptions = {}) {
    this.ops = new OpsRunnerClient(options);
  }

  async containers(): Promise<AgentContainersDto> {
    const answer = await this.ops.get<Row>('/containers');
    const rows = Array.isArray(answer['containers']) ? (answer['containers'] as Row[]) : [];
    return { generatedAt: String(answer['generatedAt'] ?? ''), containers: rows.map(container) };
  }

  async log(
    service: AgentLogService,
    query: { lines: number; errors: boolean },
  ): Promise<AgentLogDto> {
    const params = new URLSearchParams({ lines: String(query.lines) });
    if (query.errors) params.set('errors', '1');
    const answer = await this.ops.get<Row>(`/logs/${service}?${params.toString()}`);
    const lines = Array.isArray(answer['lines']) ? (answer['lines'] as unknown[]) : [];
    return {
      generatedAt: String(answer['generatedAt'] ?? ''),
      service,
      lines: lines.map((line) => scrubForAgent(String(line))),
      truncated: answer['truncated'] === true,
    };
  }
}

function container(row: Row): AgentContainerDto {
  return {
    name: String(row['name'] ?? ''),
    service: String(row['service'] ?? ''),
    state: String(row['state'] ?? ''),
    health: typeof row['health'] === 'string' ? row['health'] : null,
    status: String(row['status'] ?? ''),
    exitCode: typeof row['exitCode'] === 'number' ? row['exitCode'] : null,
  };
}
