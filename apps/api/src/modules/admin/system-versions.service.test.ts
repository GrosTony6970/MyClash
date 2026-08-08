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
        kind: 'rollback',
        deployedCommit: 'abcdef123456',
        deployedAt: '2026-05-05T08:59:00Z',
        deployedBy: 'deploy-user',
      },
      app: { version: 'v1.2.3' },
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

    // Kong was a relic of an older Supabase gateway setup; it is not part
    // of the current production stack and should not appear at all.
    expect(
      result.groups.find((group) => group.key === 'infrastructure')?.components.map((c) => c.key),
    ).not.toContain('kong');

    // The deploy section now shows "Deploy date" (formatted client-side)
    // instead of the old raw-ISO "Deployed at" label.
    expect(result.groups.find((group) => group.key === 'deploy')?.components).toContainEqual(
      expect.objectContaining({ key: 'deployedAt', label: 'Deploy date' }),
    );

    // What moved the stack, alongside when. A rollback refreshes deployedAt just
    // like a deploy does, so the date on its own reads as reassuring news.
    expect(result.deploy.kind).toBe('rollback');
    expect(result.groups.find((group) => group.key === 'deploy')?.components).toContainEqual(
      expect.objectContaining({ key: 'deployKind', version: 'rollback', source: 'deploy' }),
    );

    // Framework versions are stripped of leading semver prefixes (^, ~).
    expect(result.groups.find((group) => group.key === 'framework')?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'react', version: '19.1.0' }),
        expect.objectContaining({ key: 'nestjs', version: '10.4.0' }),
        expect.objectContaining({ key: 'typescript', version: '5.6.0' }),
      ]),
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
    expect(result.deploy.kind).toBe('unknown');
  });

  it('clamps an unrecognised deploy kind to unknown', async () => {
    // The manifest is written by shell scripts, so its `kind` is untrusted: a
    // manifest from an older deploy has no kind at all, and one from a newer
    // script could carry a value this build has no label for. Either must land on
    // `unknown` — the board translates this through an i18n key, and anything
    // outside the closed set would render as a raw bracketed key to the operator.
    const dir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-api-'));
    const manifestPath = path.join(dir, 'system-versions.json');
    await writeJson(manifestPath, {
      generatedAt: '2026-05-05T09:00:00.000Z',
      deploy: { kind: 'hotpatch', deployedCommit: 'abcdef123456' },
      app: { version: 'v1.2.3' },
    });

    const service = new AdminSystemVersionsService({
      manifestPath,
      runtimeNodeVersion: 'v22.1.0',
    });

    const result = await service.getSystemVersions();

    expect(result.deploy.kind).toBe('unknown');
    expect(result.groups.find((group) => group.key === 'deploy')?.components).toContainEqual(
      expect.objectContaining({ key: 'deployKind', version: 'unknown' }),
    );
  });

  it('reads a manifest written before deploy kinds existed as unknown', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-api-'));
    const manifestPath = path.join(dir, 'system-versions.json');
    await writeJson(manifestPath, {
      generatedAt: '2026-05-05T09:00:00.000Z',
      deploy: { deployedCommit: 'abcdef123456', deployedBy: 'deploy-user' },
      app: { version: 'v1.2.3' },
    });

    const service = new AdminSystemVersionsService({
      manifestPath,
      runtimeNodeVersion: 'v22.1.0',
    });

    const result = await service.getSystemVersions();

    // Everything else in the manifest is still trusted — only the missing field
    // degrades, so an in-flight upgrade never blanks the rest of the board.
    expect(result.deploy.kind).toBe('unknown');
    expect(result.deploy.deployedBy).toBe('deploy-user');
  });

  it('uses packaged container metadata when the manifest is unavailable', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-api-'));
    await writeFile(path.join(dir, 'VERSION'), 'v8.8.8\n');
    await writeJson(path.join(dir, 'package.json'), {
      packageManager: 'pnpm@10.27.0',
      engines: { node: '>=26.0.0' },
      devDependencies: { typescript: '^5.9.0' },
    });
    await writeJson(path.join(dir, 'apps', 'api', 'package.json'), {
      version: '0.8.0',
      dependencies: { '@nestjs/core': '^11.0.0' },
    });
    await writeJson(path.join(dir, 'apps', 'web-admin', 'package.json'), {
      version: '0.7.0',
      dependencies: { next: '15.5.0', react: '^19.1.0', 'react-dom': '^19.1.0' },
    });
    await writeJson(path.join(dir, 'apps', 'web-public', 'package.json'), { version: '0.6.0' });
    await writeJson(path.join(dir, 'apps', 'web-staff', 'package.json'), { version: '0.5.0' });
    await writeJson(path.join(dir, 'apps', 'web-marketing', 'package.json'), {
      version: '0.4.0',
    });
    await mkdir(path.join(dir, 'infra'), { recursive: true });
    await writeFile(
      path.join(dir, 'infra', 'docker-compose.prod.yml'),
      [
        'services:',
        '  traefik:',
        '    image: traefik:v3.7.1',
        '  supabase-rest:',
        '    image: postgrest/postgrest:v12.2.3',
      ].join('\n'),
    );

    const service = new AdminSystemVersionsService({
      rootDir: dir,
      manifestPath: path.join(dir, 'data', 'missing.json'),
      runtimeNodeVersion: 'v26.1.0',
    });

    const result = await service.getSystemVersions();

    expect(result.groups.find((group) => group.key === 'app')?.components).toContainEqual(
      expect.objectContaining({ key: 'myclash', version: 'v8.8.8' }),
    );
    // The Workspaces group was removed: it listed package.json versions for the
    // same apps whose real deployed version and commit appear under App
    // containers, so it duplicated that group while saying less.
    expect(result.groups.find((group) => group.key === 'workspaces')).toBeUndefined();
    expect(result.groups.find((group) => group.key === 'framework')?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'next', version: '15.5.0' }),
        expect.objectContaining({ key: 'nestjs', version: '11.0.0' }),
        expect.objectContaining({ key: 'typescript', version: '5.9.0' }),
      ]),
    );
    expect(result.deploy.deployedCommit).toBe('unknown');
    expect(result.groups.find((group) => group.key === 'infrastructure')?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'traefik', version: 'v3.7.1', source: 'compose' }),
        expect.objectContaining({ key: 'postgrest', version: 'v12.2.3', source: 'compose' }),
      ]),
    );
    expect(result.groups.find((group) => group.key === 'containers')?.components).toContainEqual(
      expect.objectContaining({ key: 'api', version: 'v8.8.8', source: 'manifest' }),
    );
  });

  it('uses GIT_COMMIT as fallback deploy and app container metadata', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-api-'));
    await writeFile(path.join(dir, 'VERSION'), 'v10.0.0\n');
    await writeJson(path.join(dir, 'package.json'), { packageManager: 'pnpm@10.27.0' });
    await mkdir(path.join(dir, 'infra'), { recursive: true });
    await writeFile(path.join(dir, 'infra', 'docker-compose.prod.yml'), 'services:\n');
    const previousCommit = process.env['GIT_COMMIT'];
    process.env['GIT_COMMIT'] = '1234567890abcdef';
    try {
      const service = new AdminSystemVersionsService({
        rootDir: dir,
        manifestPath: path.join(dir, 'data', 'missing.json'),
        runtimeNodeVersion: 'v26.1.0',
      });

      const result = await service.getSystemVersions();

      expect(result.deploy.deployedCommit).toBe('1234567890abcdef');
      expect(result.groups.find((group) => group.key === 'containers')?.components).toContainEqual(
        expect.objectContaining({
          key: 'api',
          version: 'v10.0.0 (12345678)',
          source: 'manifest',
          status: 'ok',
        }),
      );
    } finally {
      if (previousCommit === undefined) delete process.env['GIT_COMMIT'];
      else process.env['GIT_COMMIT'] = previousCommit;
    }
  });

  it('falls back cleanly when the manifest path is a directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-api-'));
    await writeFile(path.join(dir, 'VERSION'), 'v9.9.9\n');
    await writeJson(path.join(dir, 'package.json'), {
      packageManager: 'pnpm@10.27.0',
      devDependencies: { typescript: '^5.6.0' },
    });
    const manifestPath = path.join(dir, 'data', 'system-versions.json');
    await mkdir(manifestPath, { recursive: true });

    const service = new AdminSystemVersionsService({
      rootDir: dir,
      manifestPath,
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
  });

  it('falls back cleanly when the manifest contains malformed JSON', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-api-'));
    await writeFile(path.join(dir, 'VERSION'), 'v9.9.9\n');
    await writeJson(path.join(dir, 'package.json'), {
      packageManager: 'pnpm@10.27.0',
      devDependencies: { typescript: '^5.6.0' },
    });
    const manifestPath = path.join(dir, 'data', 'system-versions.json');
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, '{not json');

    const service = new AdminSystemVersionsService({
      rootDir: dir,
      manifestPath,
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
  });
});
