import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { runnerStageWorkspaces } from './dockerfile-workspaces.mjs';

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
  const { manifests, modules, hasRunnerStage } = runnerStageWorkspaces(DOCKERFILE);

  assert.equal(hasRunnerStage, true);
  assert.deepEqual([...manifests].sort(), ['packages/rules', 'packages/types']);
  assert.deepEqual([...modules], ['packages/types']);
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
