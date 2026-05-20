export type SystemVersionSource = 'manifest' | 'package.json' | 'compose' | 'runtime' | 'deploy';
export type SystemVersionStatus = 'ok' | 'unknown';

export interface SystemVersionComponentDto {
  key: string;
  label: string;
  version: string;
  source: SystemVersionSource;
  status?: SystemVersionStatus;
  /**
   * When true, the UI may render Start/Stop/Restart buttons for this row.
   * The server validates the action separately on POST, so this is purely
   * a display hint — the backend allowlist is authoritative.
   */
  restartable?: boolean;
}

export interface SystemVersionGroupDto {
  key: string;
  label: string;
  components: SystemVersionComponentDto[];
}

export interface SystemVersionsResponseDto {
  generatedAt: string;
  deploy: {
    previousCommit: string;
    deployedCommit: string;
    deployedAt: string;
    deployedBy: string;
    backupFile: string;
  };
  groups: SystemVersionGroupDto[];
}
