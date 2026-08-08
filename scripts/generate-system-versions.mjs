import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const UNKNOWN = 'unknown';
const DEPLOY_KINDS = ['deploy', 'redeploy', 'rollback', UNKNOWN];

const infrastructureServiceKeys = {
  traefik: 'traefik',
  db: 'postgres',
  redis: 'redis',
  'supabase-auth': 'supabaseAuth',
  'supabase-realtime': 'supabaseRealtime',
  'supabase-storage': 'supabaseStorage',
  kong: 'kong',
  'supabase-rest': 'postgrest',
  'supabase-meta': 'supabaseMeta',
  'supabase-studio': 'supabaseStudio',
};

const appContainerServices = [
  'api',
  'worker',
  'web-admin',
  'web-public',
  'web-staff',
  'web-marketing',
];

export async function generateSystemVersions({
  rootDir = process.cwd(),
  outputPath = path.join(rootDir, 'data', 'system-versions.json'),
  now = () => new Date(),
  deploy = {},
} = {}) {
  const rootPackage = await readJsonIfExists(path.join(rootDir, 'package.json'));
  const appVersion = (await readTextIfExists(path.join(rootDir, 'VERSION'))).trim() || UNKNOWN;
  const composeText = await readTextIfExists(
    path.join(rootDir, 'infra', 'docker-compose.prod.yml'),
  );
  const composeImages = parseComposeImages(composeText);

  const apiPackage = await readJsonIfExists(path.join(rootDir, 'apps', 'api', 'package.json'));
  const webAdminPackage = await readJsonIfExists(
    path.join(rootDir, 'apps', 'web-admin', 'package.json'),
  );

  const infrastructure = {};
  for (const [serviceName, key] of Object.entries(infrastructureServiceKeys)) {
    const image = composeImages[serviceName] ?? UNKNOWN;
    infrastructure[key] = {
      image,
      version: image === UNKNOWN ? UNKNOWN : image.split(':').slice(1).join(':') || UNKNOWN,
    };
  }

  const deployedCommit = stringOrUnknown(deploy.deployedCommit);
  const containers = {};
  for (const service of appContainerServices) {
    containers[service] = {
      version: appVersion,
      commit: deployedCommit,
    };
  }

  const result = {
    generatedAt: now().toISOString(),
    deploy: {
      // What moved the stack, not just when. A redeploy of one app and a
      // rollback both refresh deployedAt, and "deployed 3 minutes ago" is more
      // misleading than a stale date when it was actually a rollback.
      kind: deployKind(deploy.kind),
      previousCommit: stringOrUnknown(deploy.previousCommit),
      deployedCommit,
      deployedAt: stringOrUnknown(deploy.deployedAt),
      deployedBy: stringOrUnknown(deploy.deployedBy),
      backupFile: stringOrUnknown(deploy.backupFile),
    },
    app: {
      version: appVersion,
    },
    framework: {
      react: dependencyVersion(webAdminPackage, 'react'),
      reactDom: dependencyVersion(webAdminPackage, 'react-dom'),
      next: dependencyVersion(webAdminPackage, 'next'),
      nestjs: dependencyVersion(apiPackage, '@nestjs/core'),
      node: stringOrUnknown(rootPackage?.engines?.node),
      pnpm: stringOrUnknown(rootPackage?.packageManager),
      typescript: dependencyVersion(rootPackage, 'typescript'),
    },
    infrastructure,
    containers,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function parseComposeImages(composeText) {
  const images = {};
  let currentService = null;
  for (const line of composeText.split(/\r?\n/)) {
    const serviceMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (serviceMatch) {
      currentService = serviceMatch[1];
      continue;
    }

    const imageMatch = line.match(/^\s{4}image:\s*['"]?([^'"]+)['"]?\s*$/);
    if (currentService && imageMatch) {
      images[currentService] = imageMatch[1];
    }
  }
  return images;
}

async function readJsonIfExists(filePath) {
  const text = await readTextIfExists(filePath);
  if (!text) return null;
  return JSON.parse(text);
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return '';
    throw error;
  }
}

function dependencyVersion(manifest, dependencyName) {
  return stringOrUnknown(
    manifest?.dependencies?.[dependencyName] ?? manifest?.devDependencies?.[dependencyName],
  );
}

function stringOrUnknown(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : UNKNOWN;
}

/**
 * Closed set — the admin board translates this value through an i18n key, so an
 * unrecognised kind would render as a raw bracketed key rather than a label.
 * Anything unexpected collapses to `unknown`, which has a translation.
 */
function deployKind(value) {
  const kind = stringOrUnknown(value);
  return DEPLOY_KINDS.includes(kind) ? kind : UNKNOWN;
}

function parseCliArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') options.rootDir = argv[++i];
    if (arg === '--output') options.outputPath = argv[++i];
    if (arg === '--deployed-commit') {
      options.deploy = { ...(options.deploy ?? {}), deployedCommit: argv[++i] };
    }
    if (arg === '--previous-commit') {
      options.deploy = { ...(options.deploy ?? {}), previousCommit: argv[++i] };
    }
    if (arg === '--deployed-at') {
      options.deploy = { ...(options.deploy ?? {}), deployedAt: argv[++i] };
    }
    if (arg === '--deployed-by') {
      options.deploy = { ...(options.deploy ?? {}), deployedBy: argv[++i] };
    }
    if (arg === '--backup-file') {
      options.deploy = { ...(options.deploy ?? {}), backupFile: argv[++i] };
    }
    if (arg === '--kind') {
      options.deploy = { ...(options.deploy ?? {}), kind: argv[++i] };
    }
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await generateSystemVersions(parseCliArgs(process.argv.slice(2)));
}
