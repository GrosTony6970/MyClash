import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  runnerStageWorkspaces,
  runtimeWorkspaces,
  unshippedRuntimeFiles,
} from './dockerfile-workspaces.mjs';

const root = join(import.meta.dirname, '..', '..');

const DOCKERFILE = `
FROM node:26-alpine AS base
WORKDIR /app

FROM base AS prod-deps
COPY packages/types/package.json ./packages/types/

FROM node:26-alpine AS runner
WORKDIR /app
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/types/package.json ./packages/types/package.json
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/rules/package.json ./packages/rules/package.json
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --chown=nestjs:nodejs apps/web-admin/package.json ./apps/web-admin/package.json
`;

test('reads the workspaces the runner stage copies out of an earlier stage', () => {
  const { manifests, modules, dists, hasRunnerStage } = runnerStageWorkspaces(DOCKERFILE);

  assert.equal(hasRunnerStage, true);
  assert.deepEqual([...manifests].sort(), ['packages/rules', 'packages/types']);
  assert.deepEqual([...modules], ['packages/types']);
  assert.deepEqual([...dists], ['apps/api']);
});

test('ignores a package.json copied from the build context as data', () => {
  // apps/web-admin/package.json ships so the version service can read it. It is
  // not on the module path, and demanding its node_modules would be wrong.
  const { manifests } = runnerStageWorkspaces(DOCKERFILE);
  assert.equal(manifests.has('apps/web-admin'), false);
});

test('ignores COPY lines in the stages before the runner', () => {
  // The prod-deps stage above copies packages/types/package.json too. Counting
  // it would let a runner stage that ships nothing look fully wired.
  const beforeRunner = DOCKERFILE.slice(0, DOCKERFILE.indexOf('AS runner'));
  assert.equal(runnerStageWorkspaces(beforeRunner).hasRunnerStage, false);
  assert.equal(runnerStageWorkspaces(beforeRunner).manifests.size, 0);
});

test('reports no runner stage rather than throwing', () => {
  const { hasRunnerStage, manifests } = runnerStageWorkspaces('FROM scratch\n');
  assert.equal(hasRunnerStage, false);
  assert.equal(manifests.size, 0);
});

test('the real api Dockerfile ships node_modules for every workspace that has deps', () => {
  // The live assertion, duplicated from the gate on purpose: this is the fact
  // that took the api and the worker down, and it should red here too rather
  // than only inside a 430-assertion gate whose output nobody reads on a green
  // run.
  const dockerfile = readFileSync(join(root, 'apps', 'api', 'Dockerfile'), 'utf8');
  const { manifests, modules } = runnerStageWorkspaces(dockerfile);
  assert.ok(manifests.size > 0, 'no workspaces matched — the COPY pattern has rotted');

  for (const workspace of manifests) {
    const manifest = JSON.parse(
      readFileSync(join(root, ...workspace.split('/'), 'package.json'), 'utf8'),
    );
    const deps = Object.keys(manifest.dependencies ?? {});
    if (deps.length === 0) continue;
    assert.ok(
      modules.has(workspace),
      `${workspace} depends on ${deps.join(', ')} but the api runner stage does not copy ` +
        `${workspace}/node_modules — the container will throw "Cannot find module" at boot`,
    );
  }
});

test('walks workspace dependencies of dependencies, reading each manifest once', async () => {
  const manifests = {
    'packages/rulesets': {
      dependencies: { '@myclash/rules': 'workspace:^', '@myclash/types': 'workspace:^', zod: '^4' },
    },
    'packages/types': { dependencies: { '@myclash/rules': 'workspace:^' } },
    'packages/rules': {},
  };
  const reads = [];
  const found = await runtimeWorkspaces(
    { dependencies: { '@myclash/rulesets': 'workspace:^', fastify: '^5' } },
    async (workspace) => {
      reads.push(workspace);
      return manifests[workspace];
    },
  );

  assert.deepEqual(found, ['packages/rules', 'packages/rulesets', 'packages/types']);
  // rules is reached twice (rulesets → rules, types → rules) and read once.
  assert.deepEqual(reads.sort(), ['packages/rules', 'packages/rulesets', 'packages/types']);
});

test('a manifest that cannot be read still counts as needed, and ends its branch', async () => {
  // null is "unreadable, already reported by the caller". The app still needs
  // that workspace; only its own dependencies cannot be followed.
  const found = await runtimeWorkspaces(
    { dependencies: { '@myclash/types': 'workspace:^' } },
    async () => null,
  );
  assert.deepEqual(found, ['packages/types']);
});

test('an app with no workspace dependency walks to nothing', async () => {
  // The gate refuses this result: an api that needs no workspace package means
  // the manifest or the naming rule has rotted, not that the image is fine.
  assert.deepEqual(
    await runtimeWorkspaces({ dependencies: { fastify: '^5' } }, async () => null),
    [],
  );
  assert.deepEqual(await runtimeWorkspaces({}, async () => null), []);
});

const apiDockerfile = readFileSync(join(root, 'apps', 'api', 'Dockerfile'), 'utf8');

async function readRepoManifest(workspace) {
  return JSON.parse(readFileSync(join(root, ...workspace.split('/'), 'package.json'), 'utf8'));
}

async function apiRuntimeWorkspaces() {
  return runtimeWorkspaces(await readRepoManifest('apps/api'), readRepoManifest);
}

/**
 * The text with one exact line removed. Fails the test when the line is not
 * there, so a seeded break can never "pass" by having deleted nothing.
 */
function withoutLine(text, line) {
  const lines = text.split(/\r?\n/u);
  const index = lines.findIndex((candidate) => candidate.trim() === line);
  assert.notEqual(index, -1, `the seeded break did not land — no line "${line}"`);
  lines.splice(index, 1);
  return lines.join('\n');
}

test('the real api Dockerfile ships package.json and dist for every workspace the api needs', async () => {
  const workspaces = await apiRuntimeWorkspaces();
  // The walk reached the api's newest workspace dependency, and its dependency.
  assert.ok(workspaces.includes('packages/schedule-core'), workspaces.join(', '));
  assert.ok(workspaces.includes('packages/time'), workspaces.join(', '));
  assert.deepEqual(unshippedRuntimeFiles(apiDockerfile, workspaces), []);
});

test('seeded break: a runner stage without a needed dist is caught', async () => {
  const seeded = withoutLine(
    apiDockerfile,
    'COPY --from=builder --chown=nestjs:nodejs /app/packages/schedule-core/dist ./packages/schedule-core/dist',
  );
  assert.deepEqual(unshippedRuntimeFiles(seeded, await apiRuntimeWorkspaces()), [
    { workspace: 'packages/schedule-core', missing: ['dist'] },
  ]);
});

test('seeded break: a runner stage without a needed manifest is caught', async () => {
  const seeded = withoutLine(
    apiDockerfile,
    'COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/schedule-core/package.json ./packages/schedule-core/package.json',
  );
  assert.deepEqual(unshippedRuntimeFiles(seeded, await apiRuntimeWorkspaces()), [
    { workspace: 'packages/schedule-core', missing: ['package.json'] },
  ]);
  // The node_modules rule walks the manifests the runner already ships, so on
  // this break it has nothing to look at — the blind spot this check closes.
  assert.equal(runnerStageWorkspaces(seeded).manifests.has('packages/schedule-core'), false);
});
