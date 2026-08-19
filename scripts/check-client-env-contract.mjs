/**
 * Gate: every NEXT_PUBLIC_* a web app REQUIRES at build time is supplied
 * everywhere that app is built.
 *
 * Each `apps/web-<name>/next.config.ts` declares a `REQUIRED_PROD_ENV` list and
 * throws from `next build` when one is missing. That check is good — it is the
 * only layer that catches a forgotten client env — but it fires at BUILD time,
 * which means the failure lands wherever the image happens to be built rather
 * than in review. Two places were already broken when this gate was written:
 *
 *   - CI's `trivy-images` job ran a bare `docker build` with no `--build-arg`,
 *     so three of its four legs could never reach Trivy at all.
 *   - `infra/docker-compose.dev.yml` builds `target: runner` — the SAME
 *     `next build` as production — but supplied only a subset of the args. Its
 *     `NODE_ENV: development` is a RUNTIME value and never reaches the builder
 *     stage, so `docker compose -f docker-compose.dev.yml build web-admin`
 *     failed on three missing vars.
 *
 * Both were silent in the sense that matters: nothing in the gate chain read
 * these files together, so the disagreement only surfaced when someone built
 * the image.
 *
 * The contract, per app:
 *   REQUIRED_PROD_ENV  ⊆  Dockerfile `ARG NEXT_PUBLIC_*`
 *   REQUIRED_PROD_ENV  ⊆  docker-compose.prod.yml  build.args
 *   REQUIRED_PROD_ENV  ⊆  docker-compose.dev.yml   build.args   (if built there)
 *
 * CI derives its Trivy build args from the Dockerfile ARGs, so rule 1 covers
 * that leg too — an ARG present means CI supplies it.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';

const root = process.cwd();
const PROD_COMPOSE = 'infra/docker-compose.prod.yml';
const DEV_COMPOSE = 'infra/docker-compose.dev.yml';

/** The names inside a next.config.ts `REQUIRED_PROD_ENV = [...] as const`. */
export function parseRequiredEnv(source) {
  const block = /REQUIRED_PROD_ENV\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source);
  if (!block) return null;
  return [...new Set(block[1].match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? [])].sort();
}

/** Top-level `ARG NEXT_PUBLIC_*` declarations in a Dockerfile. */
export function parseDockerfileArgs(source) {
  return new Set(
    (source.match(/^ARG\s+(NEXT_PUBLIC_[A-Z0-9_]+)/gm) ?? []).map((l) => l.split(/\s+/)[1]),
  );
}

/**
 * The `build.args` keys for the service that builds `apps/<app>/Dockerfile`.
 *
 * Hand-parsed: `yaml` does not resolve from the repo root, and the shape here
 * is fixed and simple. Returns null when no service builds that Dockerfile —
 * which is a legitimate answer for the dev stack, not a failure.
 */
export function parseComposeBuildArgs(source, app) {
  const lines = source.split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(`dockerfile: apps/${app}/Dockerfile`));
  if (at === -1) return null;

  const keys = new Set();
  let inArgs = false;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    // A new top-level service key (two-space indent) ends this service.
    if (/^ {2}\S/.test(line)) break;
    if (/^\s*args:\s*$/.test(line)) {
      inArgs = true;
      continue;
    }
    if (!inArgs) continue;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const entry = /^\s*([A-Z0-9_]+):/.exec(line);
    if (entry) keys.add(entry[1]);
    else break; // dedented out of the args block
  }
  return keys;
}

/** Pure rule evaluation, so the tests need no filesystem. */
export function findGaps({ app, required, dockerfileArgs, prodArgs, devArgs }) {
  const gaps = [];
  const missing = (have) => required.filter((name) => !have.has(name));

  const noArg = missing(dockerfileArgs);
  if (noArg.length) {
    gaps.push(
      `apps/${app}/Dockerfile declares no ARG for: ${noArg.join(', ')} — next build will throw, and CI derives its Trivy args from these ARGs`,
    );
  }

  if (prodArgs === null) {
    gaps.push(`${PROD_COMPOSE} has no service building apps/${app}/Dockerfile`);
  } else {
    const noProd = missing(prodArgs);
    if (noProd.length) {
      gaps.push(`${PROD_COMPOSE} does not pass: ${noProd.join(', ')} to ${app}`);
    }
  }

  // Dev may legitimately not build an app; but if it does, it runs the same
  // `next build` and needs the same set.
  if (devArgs !== null) {
    const noDev = missing(devArgs);
    if (noDev.length) {
      gaps.push(
        `${DEV_COMPOSE} does not pass: ${noDev.join(', ')} to ${app} (it builds target: runner, so the production env check still fires)`,
      );
    }
  }

  return gaps;
}

export function scanRepo() {
  const apps = readdirSync(join(root, 'apps'))
    .filter((name) => name.startsWith('web-'))
    .filter((name) => existsSync(join(root, 'apps', name, 'next.config.ts')))
    .sort();

  const prod = readFileSync(join(root, PROD_COMPOSE), 'utf8');
  const dev = readFileSync(join(root, DEV_COMPOSE), 'utf8');

  const gaps = [];
  const checked = [];
  for (const app of apps) {
    const config = readFileSync(join(root, 'apps', app, 'next.config.ts'), 'utf8');
    const required = parseRequiredEnv(config);
    if (required === null) {
      // No build-time contract to enforce (web-marketing is a static site).
      checked.push(`${app}: no REQUIRED_PROD_ENV`);
      continue;
    }
    const dockerfile = join(root, 'apps', app, 'Dockerfile');
    if (!existsSync(dockerfile)) {
      gaps.push(`apps/${app} declares REQUIRED_PROD_ENV but has no Dockerfile`);
      continue;
    }
    gaps.push(
      ...findGaps({
        app,
        required,
        dockerfileArgs: parseDockerfileArgs(readFileSync(dockerfile, 'utf8')),
        prodArgs: parseComposeBuildArgs(prod, app),
        devArgs: parseComposeBuildArgs(dev, app),
      }),
    );
    checked.push(`${app}: ${required.length} required`);
  }

  // The empty-scan assertion this function used to make by hand is now the
  // harness's, via `scanned` below — one rule for the whole fleet.
  return { gaps, checked };
}

export const gate = defineGate({
  name: 'Client env contract',
  entry: import.meta.url,
  run: () => {
    const { gaps, checked } = scanRepo();
    return {
      findings: gaps,
      scanned: checked.length,
      summary: [`Client env contract holds (${checked.length} app(s)):`]
        .concat(checked.map((line) => `  - ${line}`))
        .join('\n'),
      remedy:
        'Every NEXT_PUBLIC_* in a next.config REQUIRED_PROD_ENV must be declared as a\n' +
        'Dockerfile ARG and passed by every compose file that builds that app.',
    };
  },
});
