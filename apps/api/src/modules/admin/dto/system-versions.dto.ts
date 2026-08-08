export type SystemVersionSource = 'manifest' | 'package.json' | 'compose' | 'runtime' | 'deploy';
export type SystemVersionStatus = 'ok' | 'unknown';

/**
 * What last moved the stack, not just when. `deployedAt` alone cannot tell a
 * full deploy from a single-app redeploy or a rollback, and "deployed 3 minutes
 * ago" reads as reassuring when the truth is "rolled back 3 minutes ago".
 *
 * Closed set: the admin board renders this through an i18n key, so a value
 * outside it would surface as a raw bracketed key. The manifest generator clamps
 * unrecognised input to `unknown`, and so does the reader — the file on disk is
 * written by shell scripts and is not trusted input.
 */
export type SystemDeployKind = 'deploy' | 'redeploy' | 'rollback' | 'unknown';

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
    kind: SystemDeployKind;
    previousCommit: string;
    deployedCommit: string;
    deployedAt: string;
    deployedBy: string;
    backupFile: string;
  };
  groups: SystemVersionGroupDto[];
}
