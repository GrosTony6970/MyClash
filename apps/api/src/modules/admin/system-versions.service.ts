import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import {
  readJsonIfExists,
  readTextIfExists,
  resolveSystemVersionsManifestPath,
  resolveSystemVersionsRootDir,
} from '../../common/system-version-paths';
import type {
  SystemDeployKind,
  SystemVersionComponentDto,
  SystemVersionsResponseDto,
  SystemVersionSource,
} from './dto/system-versions.dto';

const UNKNOWN = 'unknown';
const DEPLOY_KINDS: readonly string[] = ['deploy', 'redeploy', 'rollback', UNKNOWN];

interface RawSystemVersionsManifest {
  generatedAt?: string;
  /**
   * Every field is `string | undefined`, not the response's narrowed types: this
   * comes from a JSON file written by shell scripts, so it is untrusted input
   * that happens to be shaped like the DTO.
   */
  deploy?: Partial<Record<keyof SystemVersionsResponseDto['deploy'], string>>;
  app?: { version?: string };
  framework?: Partial<
    Record<'react' | 'reactDom' | 'next' | 'nestjs' | 'node' | 'pnpm' | 'typescript', string>
  >;
  infrastructure?: Record<string, { image?: string; version?: string }>;
  containers?: Record<string, { version?: string; commit?: string }>;
}

interface PackageManifest {
  version?: string;
  packageManager?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface AdminSystemVersionsServiceOptions {
  rootDir?: string;
  manifestPath?: string;
  runtimeNodeVersion?: string;
}

const infrastructureLabels: Record<string, string> = {
  traefik: 'Traefik',
  postgres: 'Supabase Postgres',
  redis: 'Redis',
  supabaseAuth: 'Supabase Auth',
  supabaseRealtime: 'Supabase Realtime',
  supabaseStorage: 'Supabase Storage',
  postgrest: 'PostgREST',
  supabaseMeta: 'Supabase Meta',
  supabaseStudio: 'Supabase Studio',
};

const appContainerLabels: Record<string, string> = {
  api: 'API container',
  worker: 'Worker container',
  'web-admin': 'Admin container',
  'web-public': 'Public app container',
  'web-staff': 'Scoring app container',
  'web-marketing': 'Marketing container',
};

const infrastructureServiceKeys: Record<string, string> = {
  traefik: 'traefik',
  db: 'postgres',
  redis: 'redis',
  'supabase-auth': 'supabaseAuth',
  'supabase-realtime': 'supabaseRealtime',
  'supabase-storage': 'supabaseStorage',
  'supabase-rest': 'postgrest',
  'supabase-meta': 'supabaseMeta',
  'supabase-studio': 'supabaseStudio',
};

/**
 * UI keys for components that the admin UI may surface lifecycle buttons for.
 * Mirrored by [`system-actions.service.ts`](./system-actions.service.ts) and
 * by the ops-runner allowlist; the backend re-validates on POST so this is
 * purely a display hint.
 */
const restartableKeys: ReadonlySet<string> = new Set([
  'worker',
  'web-admin',
  'web-public',
  'web-staff',
  'web-marketing',
  'redis',
  'supabaseAuth',
  'supabaseRealtime',
  'supabaseStorage',
  'postgrest',
  'supabaseMeta',
  'supabaseStudio',
]);

@Injectable()
export class AdminSystemVersionsService {
  private readonly logger = new Logger(AdminSystemVersionsService.name);
  private readonly rootDir: string;
  private readonly manifestPath: string;
  private readonly runtimeNodeVersion: string;

  constructor(options: AdminSystemVersionsServiceOptions = {}) {
    this.rootDir = options.rootDir ?? resolveSystemVersionsRootDir();
    this.manifestPath = options.manifestPath ?? resolveSystemVersionsManifestPath();
    this.runtimeNodeVersion = options.runtimeNodeVersion ?? process.version;
  }

  async getSystemVersions(): Promise<SystemVersionsResponseDto> {
    const manifestFromFile = await this.readManifest();
    const manifest = manifestFromFile ?? (await this.buildFallbackManifest());
    const appSource = manifestFromFile ? 'manifest' : 'package.json';
    const deploy = {
      kind: deployKind(manifest.deploy?.kind),
      previousCommit: valueOrUnknown(manifest.deploy?.previousCommit),
      deployedCommit: valueOrUnknown(manifest.deploy?.deployedCommit),
      deployedAt: valueOrUnknown(manifest.deploy?.deployedAt),
      deployedBy: valueOrUnknown(manifest.deploy?.deployedBy),
      backupFile: valueOrUnknown(manifest.deploy?.backupFile),
    };

    return {
      generatedAt: valueOrUnknown(manifest.generatedAt),
      deploy,
      groups: [
        {
          key: 'app',
          label: 'Application',
          components: [component('myclash', 'MyClash app', manifest.app?.version, appSource)],
        },
        {
          key: 'deploy',
          label: 'Deploy',
          components: [
            component('deployedCommit', 'Deployed commit', deploy.deployedCommit, 'deploy'),
            component('deployedAt', 'Deploy date', deploy.deployedAt, 'deploy'),
            // Directly under the date it qualifies: a refreshed date means
            // something very different after a rollback than after a deploy.
            component('deployKind', 'Deploy kind', deploy.kind, 'deploy'),
            component('deployedBy', 'Deployed by', deploy.deployedBy, 'deploy'),
            component('backupFile', 'Backup file', deploy.backupFile, 'deploy'),
          ],
        },
        {
          key: 'framework',
          label: 'Framework and runtime',
          components: [
            component(
              'react',
              'React',
              stripSemverPrefix(manifest.framework?.react),
              'package.json',
            ),
            component(
              'reactDom',
              'React DOM',
              stripSemverPrefix(manifest.framework?.reactDom),
              'package.json',
            ),
            component(
              'next',
              'Next.js',
              stripSemverPrefix(manifest.framework?.next),
              'package.json',
            ),
            component(
              'nestjs',
              'NestJS',
              stripSemverPrefix(manifest.framework?.nestjs),
              'package.json',
            ),
            component('node', 'Node.js', this.runtimeNodeVersion, 'runtime'),
            component('pnpm', 'pnpm', manifest.framework?.pnpm, 'package.json'),
            component(
              'typescript',
              'TypeScript',
              stripSemverPrefix(manifest.framework?.typescript),
              'package.json',
            ),
          ],
        },
        {
          key: 'infrastructure',
          label: 'Infrastructure',
          components: Object.entries(infrastructureLabels).map(([key, label]) =>
            component(key, label, manifest.infrastructure?.[key]?.version, 'compose'),
          ),
        },
        {
          key: 'containers',
          label: 'App containers',
          components: Object.entries(appContainerLabels).map(([key, label]) =>
            component(
              key,
              label,
              withCommit(manifest.containers?.[key]?.version, manifest.containers?.[key]?.commit),
              'manifest',
            ),
          ),
        },
      ],
    };
  }

  private async readManifest(): Promise<RawSystemVersionsManifest | null> {
    try {
      const text = await readTextIfExists(this.manifestPath);
      if (!text) {
        this.logger.warn(
          `System version manifest missing at ${this.manifestPath}; using fallback metadata from ${this.rootDir}`,
        );
        return null;
      }
      return JSON.parse(text) as RawSystemVersionsManifest;
    } catch (error) {
      this.logger.warn(
        `System version manifest unavailable at ${this.manifestPath}; using fallback metadata from ${this.rootDir} (${errorSummary(error)})`,
      );
      return null;
    }
  }

  private async buildFallbackManifest(): Promise<RawSystemVersionsManifest> {
    const rootPackage = await readJsonIfExists<PackageManifest>(
      path.join(this.rootDir, 'package.json'),
    );
    const apiPackage = await readJsonIfExists<PackageManifest>(
      path.join(this.rootDir, 'apps', 'api', 'package.json'),
    );
    const webAdminPackage = await readJsonIfExists<PackageManifest>(
      path.join(this.rootDir, 'apps', 'web-admin', 'package.json'),
    );
    const appVersion = (await readTextIfExists(path.join(this.rootDir, 'VERSION'))).trim();
    const composeText = await readTextIfExists(
      path.join(this.rootDir, 'infra', 'docker-compose.prod.yml'),
    );
    const composeImages = parseComposeImages(composeText);
    const deployedCommit = valueOrUnknown(process.env['GIT_COMMIT']);

    return {
      generatedAt: new Date().toISOString(),
      deploy: {
        deployedCommit,
      },
      app: { version: appVersion || UNKNOWN },
      framework: {
        react: dependencyVersion(webAdminPackage, 'react'),
        reactDom: dependencyVersion(webAdminPackage, 'react-dom'),
        next: dependencyVersion(webAdminPackage, 'next'),
        nestjs: dependencyVersion(apiPackage, '@nestjs/core'),
        node: rootPackage?.engines?.node ?? UNKNOWN,
        pnpm: rootPackage?.packageManager ?? UNKNOWN,
        typescript: dependencyVersion(rootPackage, 'typescript'),
      },
      infrastructure: Object.fromEntries(
        Object.entries(infrastructureServiceKeys).map(([serviceName, key]) => {
          const image = composeImages[serviceName] ?? UNKNOWN;
          return [
            key,
            {
              image,
              version: image === UNKNOWN ? UNKNOWN : image.split(':').slice(1).join(':') || UNKNOWN,
            },
          ];
        }),
      ),
      containers: Object.fromEntries(
        Object.keys(appContainerLabels).map((key) => [
          key,
          {
            version: appVersion || UNKNOWN,
            commit: deployedCommit,
          },
        ]),
      ),
    };
  }
}

function component(
  key: string,
  label: string,
  rawVersion: string | undefined,
  source: SystemVersionSource,
): SystemVersionComponentDto {
  const version = valueOrUnknown(rawVersion);
  const result: SystemVersionComponentDto = {
    key,
    label,
    version,
    source,
    status: version === UNKNOWN ? 'unknown' : 'ok',
  };
  if (restartableKeys.has(key)) result.restartable = true;
  return result;
}

function dependencyVersion(manifest: PackageManifest | null, key: string): string {
  return manifest?.dependencies?.[key] ?? manifest?.devDependencies?.[key] ?? UNKNOWN;
}

function parseComposeImages(composeText: string): Record<string, string> {
  const images: Record<string, string> = {};
  let currentService: string | null = null;
  for (const line of composeText.split(/\r?\n/u)) {
    const serviceMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (serviceMatch) {
      currentService = serviceMatch[1] ?? null;
      continue;
    }

    const imageMatch = /^\s{4}image:\s*['"]?([^'"]+)['"]?\s*$/u.exec(line);
    if (currentService && imageMatch?.[1]) images[currentService] = imageMatch[1];
  }
  return images;
}

function valueOrUnknown(value: string | undefined): string {
  return typeof value === 'string' && value.trim() ? value.trim() : UNKNOWN;
}

/**
 * Narrow the manifest's free-form string to the closed set the UI can translate.
 * A manifest written by an older deploy has no `kind` at all, and one written by
 * a future script could carry a value this build has no label for — both must
 * land on `unknown` rather than reach the board as a raw i18n key.
 */
function deployKind(value: string | undefined): SystemDeployKind {
  const kind = valueOrUnknown(value);
  return (DEPLOY_KINDS.includes(kind) ? kind : UNKNOWN) as SystemDeployKind;
}

function stripSemverPrefix(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return value;
  return value.replace(/^\s*[\^~]/u, '');
}

function withCommit(version: string | undefined, commit: string | undefined): string {
  const resolvedVersion = valueOrUnknown(version);
  const resolvedCommit = valueOrUnknown(commit);
  if (resolvedCommit === UNKNOWN) return resolvedVersion;
  return `${resolvedVersion} (${resolvedCommit.slice(0, 8)})`;
}

function errorSummary(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof record.code === 'string') return record.code;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.message === 'string') return record.message;
  }
  return 'unknown error';
}
