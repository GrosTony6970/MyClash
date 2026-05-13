import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdminSystemVersionsService } from './system-versions.service';

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

describe('AdminSystemVersionsService', () => {
  it('returns grouped version data from a manifest', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-api-'));
    const manifestPath = path.join(dir, 'system-versions.json');
    await writeJson(manifestPath, {
      generatedAt: '2026-05-05T09:00:00.000Z',
      deploy: {
        deployedCommit: 'abcdef123456',
        deployedAt: '2026-05-05T08:59:00Z',
        deployedBy: 'deploy-user',
      },
      app: { version: 'v1.2.3' },
      workspaces: {
        '@myclash/api': { version: '0.5.0' },
        '@myclash/web-admin': { version: '0.4.0' },
      },
      framework: {
        react: '^19.1.0',
        reactDom: '^19.1.0',
        next: '15.3.2',
        nestjs: '^10.4.0',
        node: '>=20.10.0',
        pnpm: 'pnpm@10.27.0',
        typescript: '^5.6.0',
      },
      infrastructure: {
        traefik: { image: 'traefik:v3.6.6', version: 'v3.6.6' },
        postgres: { image: 'supabase/postgres:15.6.1.115', version: '15.6.1.115' },
      },
      containers: {
        api: { version: 'v1.2.3', commit: 'abcdef123456' },
      },
    });

    const service = new AdminSystemVersionsService({
      manifestPath,
      runtimeNodeVersion: 'v22.1.0',
    });

    const result = await service.getSystemVersions();

    expect(result.generatedAt).toBe('2026-05-05T09:00:00.000Z');
    expect(result.deploy.deployedCommit).toBe('abcdef123456');
    expect(result.groups.find((group) => group.key === 'app')?.components).toContainEqual(
      expect.objectContaining({
        key: 'myclash',
        label: 'MyClash app',
        version: 'v1.2.3',
        source: 'manifest',
      }),
    );
    expect(result.groups.find((group) => group.key === 'framework')?.components).toContainEqual(
      expect.objectContaining({
        key: 'node',
        version: 'v22.1.0',
        source: 'runtime',
      }),
    );
    expect(
      result.groups.find((group) => group.key === 'infrastructure')?.components,
    ).toContainEqual(
      expect.objectContaining({
        key: 'traefik',
        version: 'v3.6.6',
        source: 'compose',
      }),
    );
  });

  it('falls back cleanly when the manifest is missing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-api-'));
    await writeFile(path.join(dir, 'VERSION'), 'v9.9.9\n');
    await writeJson(path.join(dir, 'package.json'), {
      packageManager: 'pnpm@10.27.0',
      devDependencies: { typescript: '^5.6.0' },
    });

    const service = new AdminSystemVersionsService({
      rootDir: dir,
      manifestPath: path.join(dir, 'data', 'missing.json'),
      runtimeNodeVersion: 'v22.1.0',
    });

    const result = await service.getSystemVersions();

    expect(result.groups.find((group) => group.key === 'app')?.components).toContainEqual(
      expect.objectContaining({
        key: 'myclash',
        version: 'v9.9.9',
        source: 'package.json',
      }),
    );
    expect(result.groups.find((group) => group.key === 'deploy')?.components).toContainEqual(
      expect.objectContaining({
        key: 'deployedCommit',
        version: 'unknown',
        source: 'deploy',
        status: 'unknown',
      }),
    );
  });
});
