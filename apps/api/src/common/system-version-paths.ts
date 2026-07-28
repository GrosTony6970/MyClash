/**
 * Where deployment version metadata lives on disk, and how to read it safely.
 *
 * Two services answer "what is running?" from the same two artefacts — the
 * `data/system-versions.json` manifest written by `scripts/generate-system-versions.mjs`
 * at deploy time, and the repo-root `VERSION` file baked into the image:
 *
 *   - `modules/admin/system-versions.service.ts` — the full super-admin board
 *     (infra images, workspace versions, deployedBy, backupFile).
 *   - `modules/health/version.service.ts`        — the public `GET /api/v1/version`
 *     projection (app version, commit, deployedAt only).
 *
 * They resolve those paths HERE rather than each carrying its own copy. Two
 * copies of `SYSTEM_VERSIONS_PATH ?? cwd/data/system-versions.json` is exactly
 * the kind of duplicated declaration that drifts: change the compose mount or
 * the env var name and one reader keeps working while the other silently
 * reports `unknown`, with nothing failing. One owner makes that impossible
 * instead of merely detectable.
 *
 * Both paths are overridable per-instance (the services take options) so tests
 * can point at a temp dir without touching process.env.
 */
import { statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Absolute path to the deploy-time manifest. Set in `infra/docker-compose.prod.yml`. */
export function resolveSystemVersionsManifestPath(): string {
  return (
    process.env['SYSTEM_VERSIONS_PATH'] ?? path.join(process.cwd(), 'data', 'system-versions.json')
  );
}

/**
 * Repo root as seen from the running process — where `VERSION`, `package.json`
 * and `infra/docker-compose.prod.yml` are found.
 *
 * `/app` is the container layout; `cwd` and its grandparent cover running from
 * the repo root and from `apps/api` in local dev. First candidate that actually
 * holds a `package.json` wins, so a wrong guess degrades to the next one rather
 * than to `unknown`.
 */
export function resolveSystemVersionsRootDir(): string {
  const candidates = [
    process.env['SYSTEM_VERSIONS_ROOT_DIR'],
    '/app',
    process.cwd(),
    path.resolve(process.cwd(), '..', '..'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (hasRootPackage(candidate)) return candidate;
  }

  return path.resolve(process.cwd(), '..', '..');
}

function hasRootPackage(rootDir: string): boolean {
  return statSyncSafe(path.join(rootDir, 'package.json'))?.isFile() ?? false;
}

function statSyncSafe(filePath: string) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

/**
 * File contents, or `''` when the path is missing or is a directory.
 *
 * The directory case is not hypothetical: `docker compose up` creates a
 * DIRECTORY at a bind-mount source that does not exist yet, so a deploy that
 * never ran the generator leaves `data/system-versions.json` as an empty dir.
 * Both callers must degrade to their fallbacks there rather than throw.
 */
export async function readTextIfExists(filePath: string): Promise<string> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return '';
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'EISDIR')
    ) {
      return '';
    }
    throw error;
  }
}

/** Parsed JSON, or `null` when the file is absent. Throws on malformed JSON — callers catch. */
export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  const text = await readTextIfExists(filePath);
  return text ? (JSON.parse(text) as T) : null;
}
