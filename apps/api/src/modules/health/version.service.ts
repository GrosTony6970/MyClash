import path from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  readTextIfExists,
  resolveSystemVersionsManifestPath,
  resolveSystemVersionsRootDir,
} from '../../common/system-version-paths';
import type { VersionResponseDto } from './dto/version-response.dto';

const UNKNOWN = 'unknown';

/** Process start, captured once at module load — mirrors START_TIME in health.controller.ts. */
const START_TIME = Date.now();

/**
 * The slice of `data/system-versions.json` this endpoint is allowed to read.
 *
 * Deliberately narrow. The manifest also carries `deployedBy`, `backupFile`,
 * `previousCommit` and every infrastructure image tag — that is why the full
 * board sits behind PlatformRoleGuard. Typing only these three fields means a
 * later `return { ...manifest }` cannot compile, so the private fields cannot
 * leak into a public response by accident.
 */
interface VersionManifestSlice {
  app?: { version?: string };
  deploy?: { deployedAt?: string };
  containers?: { api?: { commit?: string } };
}

export interface VersionServiceOptions {
  rootDir?: string;
  manifestPath?: string;
}

@Injectable()
export class VersionService {
  private readonly rootDir: string;
  private readonly manifestPath: string;

  /**
   * Memoised because this endpoint is public and unauthenticated: without it,
   * every caller costs two filesystem reads. The inputs cannot change under a
   * live process anyway — the manifest is a read-only bind mount (replacing the
   * file on the host does not update the container's pinned inode) and `VERSION`
   * is baked into the image, so a new value only ever arrives with a new
   * container. Cached on the promise, not the result, so concurrent first
   * requests share one read instead of racing.
   */
  private cached: Promise<VersionResponseDto> | null = null;

  constructor(options: VersionServiceOptions = {}) {
    this.rootDir = options.rootDir ?? resolveSystemVersionsRootDir();
    this.manifestPath = options.manifestPath ?? resolveSystemVersionsManifestPath();
  }

  async getVersion(): Promise<VersionResponseDto> {
    this.cached ??= this.resolveVersion();
    const resolved = await this.cached;
    // uptime is the one field that must not be cached.
    return { ...resolved, uptime: (Date.now() - START_TIME) / 1000 };
  }

  private async resolveVersion(): Promise<VersionResponseDto> {
    const manifest = await this.readManifest();
    const fileVersion = (await readTextIfExists(path.join(this.rootDir, 'VERSION'))).trim();

    return {
      version: firstNonEmpty(manifest?.app?.version, fileVersion) ?? UNKNOWN,
      commit: shortCommit(
        firstNonEmpty(manifest?.containers?.api?.commit, process.env['GIT_COMMIT']),
      ),
      deployedAt: firstNonEmpty(manifest?.deploy?.deployedAt) ?? null,
      environment:
        firstNonEmpty(process.env['SENTRY_ENVIRONMENT'], process.env['NODE_ENV']) ?? 'production',
      uptime: 0, // replaced per-request by getVersion()
    };
  }

  /**
   * Never throws. A version endpoint that 500s on a half-finished deploy is
   * useless at the exact moment somebody is asking what went out, so a missing
   * or malformed manifest degrades to GIT_COMMIT + the VERSION file and the
   * response is still a 200.
   */
  private async readManifest(): Promise<VersionManifestSlice | null> {
    try {
      const text = await readTextIfExists(this.manifestPath);
      return text ? (JSON.parse(text) as VersionManifestSlice) : null;
    } catch {
      return null;
    }
  }
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Truncated to 8 characters, matching `withCommit()` in
 * `modules/admin/system-versions.service.ts` so the public endpoint and the
 * admin board never show the same deploy as two different-looking commits.
 */
function shortCommit(commit: string | undefined): string {
  if (!commit || commit === UNKNOWN) return UNKNOWN;
  return commit.slice(0, 8);
}
