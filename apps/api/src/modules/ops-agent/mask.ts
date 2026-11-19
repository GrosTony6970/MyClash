import type {
  BackupLocation,
  BackupOperationKind,
  BackupOperationStatus,
  BackupStatusDto,
} from '../admin/dto/admin-backups.dto';
import type { SystemVersionsResponseDto } from '../admin/dto/system-versions.dto';
import { RUNTIME_HEALTH_TIMEOUT } from '@myclash/types';

/** What stands in for an error text the door does not pass. */
export const WITHHELD_ERROR = 'withheld';

/** Error values the API itself writes as codes, not free text: they may pass. */
const ERROR_CODES: ReadonlySet<string> = new Set([RUNTIME_HEALTH_TIMEOUT]);

/**
 * Replaces every string under a key named `error`, at any depth, with `withheld`, unless it is
 * one of the API's own codes. Runtime health, host facts and certificates carry raw
 * `Error.message` texts there (a Postgres message can quote a row; the ops runner's can be shell
 * output). The field stays, so the agent still sees that a part is down. The log scrub
 * (`scrubForAgent`) does not open them: ruling 870 keeps them withheld, and the logs say why.
 */
export function withoutErrorText<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => withoutErrorText(item)) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    out[key] =
      key === 'error' && typeof field === 'string'
        ? ERROR_CODES.has(field)
          ? field
          : WITHHELD_ERROR
        : withoutErrorText(field);
  }
  return out as T;
}

/**
 * What the ops agent may see of the admin reads (the ops agent's design, section 2: no person, and
 * no error text: ruling 870 keeps it withheld; the scrub is for log lines only).
 */
export type AgentVersionsDto = Omit<SystemVersionsResponseDto, 'deploy'> & {
  deploy: Omit<SystemVersionsResponseDto['deploy'], 'deployedBy'>;
};

export interface AgentBackupStatusDto {
  generatedAt: string;
  cloudConfigured: boolean;
  lastBackup: {
    timestamp: string;
    status: 'success' | 'failed' | 'unknown';
    finishedAt: string | null;
    code: string | null;
    localAvailable: boolean;
    cloudAvailable: boolean;
  } | null;
  runningOperation: {
    id: string;
    kind: BackupOperationKind;
    status: BackupOperationStatus;
    startedAt: string;
    finishedAt: string | null;
    source: BackupLocation | null;
    backupId: string | null;
    code: string | null;
  } | null;
}

/** Leaves out who deployed: the server login (`deploy.sh`'s `SUDO_USER`), in both places. */
export function maskVersions(dto: SystemVersionsResponseDto): AgentVersionsDto {
  const { deployedBy: _deployedBy, ...deploy } = dto.deploy;
  return {
    generatedAt: dto.generatedAt,
    deploy,
    groups: dto.groups.map((group) => ({
      ...group,
      components: group.components.filter((component) => component.key !== 'deployedBy'),
    })),
  };
}

/**
 * Built field by field: the ops runner's JSON reaches `AdminBackupsService` untyped, so a spread
 * would pass on whatever it adds. The shell's log lines and both error texts stay out.
 */
export function maskBackups(dto: BackupStatusDto): AgentBackupStatusDto {
  const last = dto.lastBackup;
  const op = dto.runningOperation;
  return {
    generatedAt: dto.generatedAt,
    cloudConfigured: dto.cloudConfigured,
    lastBackup: last
      ? {
          timestamp: last.timestamp,
          status: last.status,
          finishedAt: last.finishedAt ?? null,
          code: last.code ?? null,
          localAvailable: last.localAvailable,
          cloudAvailable: last.cloudAvailable,
        }
      : null,
    runningOperation: op
      ? {
          id: op.id,
          kind: op.kind,
          status: op.status,
          startedAt: op.startedAt,
          finishedAt: op.finishedAt ?? null,
          source: op.source ?? null,
          backupId: op.backupId ?? null,
          code: op.code ?? null,
        }
      : null,
  };
}
