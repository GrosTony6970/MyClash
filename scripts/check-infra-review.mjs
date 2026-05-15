import { readFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const composePath = path.join(rootDir, 'infra', 'docker-compose.prod.yml');
const devComposePath = path.join(rootDir, 'infra', 'docker-compose.dev.yml');
const deployPath = path.join(rootDir, 'infra', 'scripts', 'deploy.sh');
const traefikMiddlewarePath = path.join(rootDir, 'infra', 'config', 'traefik', 'middlewares.yml');
const realtimeInitPath = path.join(rootDir, 'infra', 'db', 'init', '02-supabase-realtime.sh');
const realtimeMigrationPath = path.join(
  rootDir,
  'packages',
  'db',
  'migrations',
  '0035_realtime_internal_schema.sql',
);
const dockerfilePaths = [
  'apps/api/Dockerfile',
  'apps/web-admin/Dockerfile',
  'apps/web-public/Dockerfile',
  'apps/web-scoring/Dockerfile',
  'apps/web-marketing/Dockerfile',
  'infra/ops-runner/Dockerfile',
];

const composeText = await readFile(composePath, 'utf8');
const devComposeText = await readFile(devComposePath, 'utf8');
const deployText = await readFile(deployPath, 'utf8');
const traefikMiddlewareText = await readFile(traefikMiddlewarePath, 'utf8');
const realtimeInitText = await readFile(realtimeInitPath, 'utf8');
const realtimeMigrationText = await readFile(realtimeMigrationPath, 'utf8');
const dockerfiles = await Promise.all(
  dockerfilePaths.map(async (filePath) => ({
    filePath,
    text: await readFile(path.join(rootDir, filePath), 'utf8'),
  })),
);

const errors = [];
const warnings = [];

const services = parseServices(composeText);
const devServices = parseServices(devComposeText);
const requiredServices = [
  'traefik',
  'db',
  'redis',
  'supabase-auth',
  'supabase-realtime',
  'supabase-storage',
  'api',
  'ops-runner',
  'worker',
  'web-public',
  'web-marketing',
  'web-scoring',
  'web-admin',
];

for (const serviceName of requiredServices) {
  const service = services.get(serviceName);
  if (!service) {
    errors.push(`Missing service: ${serviceName}`);
    continue;
  }
  requireContains(service, serviceName, 'restart: unless-stopped');
  requireContains(service, serviceName, 'logging:');
  requireContains(service, serviceName, 'driver: json-file');
  requireContains(service, serviceName, "max-size: '10m'");

  if (!['worker'].includes(serviceName)) {
    requireContains(service, serviceName, 'healthcheck:');
  }

  if (!['ops-runner'].includes(serviceName)) {
    requireContains(service, serviceName, 'mem_limit:');
    requireContains(service, serviceName, 'cpus:');
  } else {
    requireContains(service, serviceName, 'mem_limit:');
    requireContains(service, serviceName, 'cpus:');
    if (/traefik\.http\.routers\./.test(service)) {
      errors.push('ops-runner must remain internal-only and must not define Traefik routers.');
    }
    requireContains(service, serviceName, '/var/run/docker.sock:/var/run/docker.sock');
  }
}

for (const [label, service] of [
  ['prod supabase-realtime', services.get('supabase-realtime')],
  ['dev supabase-realtime', devServices.get('supabase-realtime')],
]) {
  if (!service) {
    errors.push(`${label} service is missing.`);
    continue;
  }
  requireContains(service, label, "DB_AFTER_CONNECT_QUERY: 'SET search_path TO _realtime'");
  requireContains(service, label, 'DB_ENC_KEY:');
  requireContains(service, label, 'API_JWT_SECRET:');
  requireContains(service, label, "SEED_SELF_HOST: 'true'");
  requireContains(service, label, 'SELF_HOST_TENANT_NAME: realtime');
}

for (const [label, text] of [
  ['infra/db/init/02-supabase-realtime.sh', realtimeInitText],
  ['packages/db/migrations/0035_realtime_internal_schema.sql', realtimeMigrationText],
]) {
  requireContains(text, label, 'CREATE SCHEMA IF NOT EXISTS _realtime');
}
requireContains(
  composeText,
  'infra/docker-compose.prod.yml',
  './db/init/02-supabase-realtime.sh:/docker-entrypoint-initdb.d/02-supabase-realtime.sh:ro',
);
requireContains(
  devComposeText,
  'infra/docker-compose.dev.yml',
  './db/init/02-supabase-realtime.sh:/docker-entrypoint-initdb.d/02-supabase-realtime.sh:ro',
);
if (!deployText.includes('SUPABASE_REALTIME_DB_ENC_KEY:?Missing SUPABASE_REALTIME_DB_ENC_KEY')) {
  errors.push('deploy.sh must require SUPABASE_REALTIME_DB_ENC_KEY.');
}

for (const serviceName of ['api', 'web-public', 'web-scoring', 'web-admin']) {
  const dockerfile = dockerfiles.find((file) =>
    file.filePath.includes(serviceName.replace('web-', 'web-')),
  );
  if (dockerfile && !/\nUSER\s+\w+/u.test(dockerfile.text)) {
    errors.push(`${dockerfile.filePath} must set a non-root USER in the runner stage.`);
  }
}

const marketingDockerfile = dockerfiles.find(
  (file) => file.filePath === 'apps/web-marketing/Dockerfile',
);
if (marketingDockerfile && !/FROM caddy:/u.test(marketingDockerfile.text)) {
  warnings.push(
    'Marketing Dockerfile no longer uses the expected Caddy static image; review non-root behavior.',
  );
}

const apiDockerfile = dockerfiles.find((file) => file.filePath === 'apps/api/Dockerfile');
if (apiDockerfile) {
  requireContains(
    apiDockerfile.text,
    apiDockerfile.filePath,
    'COPY packages/db/package.json ./packages/db/',
  );
  requireContains(apiDockerfile.text, apiDockerfile.filePath, '--filter @myclash/db');
  requireContains(
    apiDockerfile.text,
    apiDockerfile.filePath,
    '/app/packages/db/node_modules ./packages/db/node_modules',
  );
  requireContains(
    apiDockerfile.text,
    apiDockerfile.filePath,
    'packages/db/scripts/migrate.mjs ./packages/db/scripts/migrate.mjs',
  );
  if (apiDockerfile.text.includes('./db-migrate.mjs')) {
    errors.push(
      'apps/api/Dockerfile must not copy the DB migration script to /app/db-migrate.mjs.',
    );
  }
}
if (!deployText.includes('run --rm api node packages/db/scripts/migrate.mjs')) {
  errors.push('deploy.sh must run migrations from packages/db/scripts/migrate.mjs.');
}
if (deployText.includes('run --rm api node db-migrate.mjs')) {
  errors.push('deploy.sh must not run the legacy /app/db-migrate.mjs migration shim.');
}

const headers = [
  'stsSeconds: 31536000',
  'stsIncludeSubdomains: true',
  'stsPreload: false',
  'contentTypeNosniff: true',
  'frameDeny: true',
  'referrerPolicy: strict-origin-when-cross-origin',
];
for (const header of headers) {
  if (!traefikMiddlewareText.includes(header))
    errors.push(`Missing Traefik security header setting: ${header}`);
}
for (const expected of [
  '--entrypoints.web.http.redirections.entrypoint.to=websecure',
  '--entrypoints.web.http.redirections.entrypoint.scheme=https',
  '--certificatesresolvers.letsencrypt.acme.storage=/data/acme.json',
  '--certificatesresolvers.letsencrypt.acme.tlschallenge=true',
]) {
  if (!composeText.includes(expected)) errors.push(`Missing Traefik edge setting: ${expected}`);
}
if (!deployText.includes('chmod 600 "$ACME_FILE"')) {
  errors.push('deploy.sh must enforce ACME storage permissions with chmod 600.');
}

const publicRouters = [
  'myclash-api',
  'myclash-auth',
  'myclash-realtime',
  'myclash-storage',
  'myclash-public',
  'myclash-marketing',
  'myclash-scoring',
  'myclash-admin',
];
for (const router of publicRouters) {
  const pattern = new RegExp(
    `traefik\\.http\\.routers\\.${escapeRegExp(router)}\\.middlewares=.*myclash-security-headers@file`,
    'u',
  );
  if (!pattern.test(composeText)) {
    errors.push(`Router ${router} must use myclash-security-headers@file.`);
  }
}

const composeImages = [...composeText.matchAll(/^\s+image:\s+([^\s#]+)/gmu)].map(
  (match) => match[1],
);
for (const image of composeImages) {
  if (!image.includes('@sha256:')) {
    warnings.push(`Compose image is tag-pinned but not digest-pinned: ${image}`);
  }
}
for (const { filePath, text } of dockerfiles) {
  for (const match of text.matchAll(/^FROM\s+([^\s]+)/gmu)) {
    const image = match[1];
    if (!image.includes('/') && !image.includes(':') && !image.includes('${')) continue;
    if (!image.includes('@sha256:')) {
      warnings.push(`${filePath} base image is not digest-pinned: ${image}`);
    }
  }
}

if (warnings.length > 0) {
  console.warn('Infrastructure review warnings:');
  for (const warning of new Set(warnings)) console.warn(`  - ${warning}`);
}

if (errors.length > 0) {
  console.error('Infrastructure review blockers:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Infrastructure review passed for ${requiredServices.length} services.`);

function parseServices(text) {
  const lines = text.split(/\r?\n/u);
  const result = new Map();
  let currentName = null;
  let currentLines = [];
  for (const line of lines) {
    const serviceMatch = /^  ([a-zA-Z0-9_-]+):\s*$/u.exec(line);
    if (serviceMatch && !['networks', 'volumes'].includes(serviceMatch[1])) {
      if (currentName) result.set(currentName, currentLines.join('\n'));
      currentName = serviceMatch[1];
      currentLines = [line];
      continue;
    }
    if (/^(networks|volumes):\s*$/u.test(line)) break;
    if (currentName) currentLines.push(line);
  }
  if (currentName) result.set(currentName, currentLines.join('\n'));
  return result;
}

function requireContains(text, serviceName, expected) {
  if (!text.includes(expected)) errors.push(`${serviceName} is missing ${expected}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
