import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminSystemVersionsService } from '../admin/system-versions.service';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';

const MANIFEST = {
  generatedAt: '2026-07-28T18:04:12.000Z',
  deploy: {
    deployedCommit: 'b3aa5011deadbeef',
    deployedAt: '2026-07-28T18:04:11.000Z',
    // Present in the real manifest and deliberately NOT in the public payload.
    deployedBy: 'deploy-user',
    backupFile: 'backup-2026-07-28.sql.gz',
  },
  app: { version: 'v1.2.3' },
  containers: { api: { version: 'v1.2.3', commit: 'b3aa5011deadbeef' } },
};

async function writeManifest(dir: string, value: unknown): Promise<string> {
  const manifestPath = path.join(dir, 'data', 'system-versions.json');
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
  return manifestPath;
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'myclash-version-'));
}

/**
 * Build the controller over a service pointed at a temp dir.
 *
 * Constructed directly rather than through `Test.createTestingModule`, matching
 * every other controller test here: vitest transforms with esbuild, which drops
 * `emitDecoratorMetadata`, so Nest's DI cannot resolve constructor params and
 * injects `undefined`. (health.controller.test.ts gets away with the testing
 * module only because that controller takes no dependencies.)
 */
function controllerFor(options: { rootDir?: string; manifestPath?: string }): VersionController {
  return new VersionController(new VersionService(options));
}

describe('VersionController', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['GIT_COMMIT'];
    delete process.env['SYSTEM_VERSIONS_PATH'];
    delete process.env['SENTRY_ENVIRONMENT'];
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('surfaces version, commit and deploy time from the manifest', async () => {
    const dir = await tempRoot();
    const manifestPath = await writeManifest(dir, MANIFEST);

    const result = await controllerFor({ rootDir: dir, manifestPath }).getVersion();

    expect(result.version).toBe('v1.2.3');
    expect(result.commit).toBe('b3aa5011');
    expect(result.deployedAt).toBe('2026-07-28T18:04:11.000Z');
  });

  it('truncates the commit to 8 characters, matching the admin board', async () => {
    const dir = await tempRoot();
    const manifestPath = await writeManifest(dir, MANIFEST);

    const result = await controllerFor({ rootDir: dir, manifestPath }).getVersion();

    expect(result.commit).toHaveLength(8);
    expect(MANIFEST.containers.api.commit.startsWith(result.commit)).toBe(true);
  });

  /**
   * The reason this endpoint is a hand-picked projection rather than a manifest
   * passthrough. If someone widens it to spread the manifest, this fails.
   */
  it('never leaks the private manifest fields', async () => {
    const dir = await tempRoot();
    const manifestPath = await writeManifest(dir, MANIFEST);

    const result = await controllerFor({ rootDir: dir, manifestPath }).getVersion();

    expect(Object.keys(result).sort()).toEqual([
      'commit',
      'deployedAt',
      'environment',
      'uptime',
      'version',
    ]);
    expect(JSON.stringify(result)).not.toContain('deploy-user');
    expect(JSON.stringify(result)).not.toContain('backup-2026-07-28');
  });

  it('falls back to GIT_COMMIT and the VERSION file when the manifest is missing', async () => {
    const dir = await tempRoot();
    await writeFile(path.join(dir, 'VERSION'), 'v9.9.9\n');
    process.env['GIT_COMMIT'] = '1234567890abcdef';

    const result = await controllerFor({
      rootDir: dir,
      manifestPath: path.join(dir, 'data', 'missing.json'),
    }).getVersion();

    expect(result.version).toBe('v9.9.9');
    expect(result.commit).toBe('12345678');
    expect(result.deployedAt).toBeNull();
  });

  /**
   * A half-finished deploy is exactly when someone asks what is running, so a
   * broken manifest must still answer 200 rather than throw.
   */
  it('does not throw on a malformed manifest', async () => {
    const dir = await tempRoot();
    const manifestPath = path.join(dir, 'data', 'system-versions.json');
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, '{not json');

    const result = await controllerFor({ rootDir: dir, manifestPath }).getVersion();

    expect(result.version).toBe('unknown');
    expect(result.commit).toBe('unknown');
    expect(result.deployedAt).toBeNull();
  });

  it('does not throw when the manifest path is a directory', async () => {
    // `docker compose up` creates a directory at a bind-mount source that does
    // not exist yet, so this is the shape of a deploy that skipped the generator.
    const dir = await tempRoot();
    await writeFile(path.join(dir, 'VERSION'), 'v9.9.9\n');
    const manifestPath = path.join(dir, 'data', 'system-versions.json');
    await mkdir(manifestPath, { recursive: true });

    const result = await controllerFor({ rootDir: dir, manifestPath }).getVersion();

    expect(result.version).toBe('v9.9.9');
  });

  it('reports uptime as a non-negative number', async () => {
    const dir = await tempRoot();
    const manifestPath = await writeManifest(dir, MANIFEST);

    const result = await controllerFor({ rootDir: dir, manifestPath }).getVersion();

    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('resolves the environment the same way the Sentry tag does', async () => {
    const dir = await tempRoot();
    const manifestPath = await writeManifest(dir, MANIFEST);
    process.env['SENTRY_ENVIRONMENT'] = 'staging';

    const result = await controllerFor({ rootDir: dir, manifestPath }).getVersion();

    expect(result.environment).toBe('staging');
  });
});

/**
 * Both readers of data/system-versions.json must resolve it from the same place.
 * They share `common/system-version-paths.ts` precisely so they cannot drift —
 * this pins the behaviour, so moving the mount or renaming the env var can never
 * leave one reader working and the other silently reporting "unknown".
 */
describe('deploy manifest path resolution', () => {
  const savedPath = process.env['SYSTEM_VERSIONS_PATH'];

  afterEach(() => {
    if (savedPath === undefined) delete process.env['SYSTEM_VERSIONS_PATH'];
    else process.env['SYSTEM_VERSIONS_PATH'] = savedPath;
  });

  it('is shared by the public endpoint and the super-admin board', async () => {
    const dir = await tempRoot();
    process.env['SYSTEM_VERSIONS_PATH'] = await writeManifest(dir, MANIFEST);

    // Neither is given an explicit manifestPath — both must find it via the env var.
    const publicVersion = await new VersionService().getVersion();
    const adminVersions = await new AdminSystemVersionsService().getSystemVersions();

    expect(publicVersion.version).toBe('v1.2.3');
    expect(adminVersions.groups.find((group) => group.key === 'app')?.components).toContainEqual(
      expect.objectContaining({ key: 'myclash', version: 'v1.2.3', source: 'manifest' }),
    );
    // Same deploy, same commit — the admin board renders it as "version (commit)".
    expect(adminVersions.deploy.deployedCommit).toBe(MANIFEST.deploy.deployedCommit);
    expect(MANIFEST.deploy.deployedCommit.startsWith(publicVersion.commit)).toBe(true);
  });
});
