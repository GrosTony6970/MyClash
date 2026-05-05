export type SystemVersionSource = 'manifest' | 'package.json' | 'compose' | 'runtime' | 'deploy';
export type SystemVersionStatus = 'ok' | 'unknown';

export interface SystemVersionComponentDto {
  key: string;
  label: string;
  version: string;
  source: SystemVersionSource;
  status?: SystemVersionStatus;
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
