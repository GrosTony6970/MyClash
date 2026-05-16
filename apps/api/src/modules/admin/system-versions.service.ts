import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type {
  SystemVersionComponentDto,
  SystemVersionsResponseDto,
  SystemVersionSource,
} from './dto/system-versions.dto';

const UNKNOWN = 'unknown';

interface RawSystemVersionsManifest {
  generatedAt?: string;
  deploy?: Partial<SystemVersionsResponseDto['deploy']>;
  app?: { version?: string };
  workspaces?: Record<string, { version?: string }>;
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

const workspaceLabels: Record<string, string> = {
  '@myclash/api': 'API workspace',
  '@myclash/web-admin': 'Admin app workspace',
  '@myclash/web-public': 'Public app workspace',
  '@myclash/web-scoring': 'Scoring app workspace',
  '@myclash/web-marketing': 'Marketing site workspace',
};

const infrastructureLabels: Record<string, string> = {
  traefik: 'Traefik',
  postgres: 'Supabase Postgres',
  redis: 'Redis',
  supabaseAuth: 'Supabase Auth',
  supabaseRealtime: 'Supabase Realtime',
  supabaseStorage: 'Supabase Storage',
  kong: 'Kong',
  postgrest: 'PostgREST',
};

const appContainerLabels: Record<string, string> = {
  api: 'API container',
  worker: 'Worker container',
  'web-admin': 'Admin container',
  'web-public': 'Public app container',
  'web-scoring': 'Scoring app container',
  'web-marketing': 'Marketing container',
};

@Injectable()
export class AdminSystemVersionsService {
  private readonly logger = new Logger(AdminSystemVersionsService.name);
  private readonly rootDir: string;
  private readonly manifestPath: string;
  private readonly runtimeNodeVersion: string;

  constructor(options: AdminSystemVersionsServiceOptions = {}) {
    this.rootDir = options.rootDir ?? path.resolve(process.cwd(), '..', '..');
    this.manifestPath =
      options.manifestPath ??
      process.env['SYSTEM_VERSIONS_PATH'] ??
      path.join(process.cwd(), 'data', 'system-versions.json');
    this.runtimeNodeVersion = options.runtimeNodeVersion ?? process.version;
  }

  async getSystemVersions(): Promise<SystemVersionsResponseDto> {
    const manifestFromFile = await this.readManifest();
    const manifest = manifestFromFile ?? (await this.buildFallbackManifest());
    const appSource = manifestFromFile ? 'manifest' : 'package.json';
    const deploy = {
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
            component('deployedAt', 'Deployed at', deploy.deployedAt, 'deploy'),
            component('deployedBy', 'Deployed by', deploy.deployedBy, 'deploy'),
            component('backupFile', 'Backup file', deploy.backupFile, 'deploy'),
          ],
        },
        {
          key: 'workspaces',
          label: 'Workspaces',
          components: Object.entries(workspaceLabels).map(([key, label]) =>
            component(key, label, manifest.workspaces?.[key]?.version, 'package.json'),
          ),
        },
        {
          key: 'framework',
          label: 'Framework and runtime',
          components: [
            component('react', 'React', manifest.framework?.react, 'package.json'),
            component('reactDom', 'React DOM', manifest.framework?.reactDom, 'package.json'),
            component('next', 'Next.js', manifest.framework?.next, 'package.json'),
            component('nestjs', 'NestJS', manifest.framework?.nestjs, 'package.json'),
            component('node', 'Node.js', this.runtimeNodeVersion, 'runtime'),
            component('pnpm', 'pnpm', manifest.framework?.pnpm, 'package.json'),
            component('typescript', 'TypeScript', manifest.framework?.typescript, 'package.json'),
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
      return text ? (JSON.parse(text) as RawSystemVersionsManifest) : null;
    } catch (error) {
      this.logger.warn(
        `System version manifest unavailable at ${this.manifestPath}; using fallback metadata (${errorSummary(error)})`,
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

    return {
      generatedAt: new Date().toISOString(),
      deploy: {},
      app: { version: appVersion || UNKNOWN },
      workspaces: await this.readWorkspaceVersions(),
      framework: {
        react: dependencyVersion(webAdminPackage, 'react'),
        reactDom: dependencyVersion(webAdminPackage, 'react-dom'),
        next: dependencyVersion(webAdminPackage, 'next'),
        nestjs: dependencyVersion(apiPackage, '@nestjs/core'),
        node: rootPackage?.engines?.node ?? UNKNOWN,
        pnpm: rootPackage?.packageManager ?? UNKNOWN,
        typescript: dependencyVersion(rootPackage, 'typescript'),
      },
      infrastructure: {},
      containers: {},
    };
  }

  private async readWorkspaceVersions(): Promise<Record<string, { version: string }>> {
    const result: Record<string, { version: string }> = {};
    const paths: Record<string, string> = {
      '@myclash/api': 'apps/api/package.json',
      '@myclash/web-admin': 'apps/web-admin/package.json',
      '@myclash/web-public': 'apps/web-public/package.json',
      '@myclash/web-scoring': 'apps/web-scoring/package.json',
      '@myclash/web-marketing': 'apps/web-marketing/package.json',
    };
    for (const [key, relativePath] of Object.entries(paths)) {
      const manifest = await readJsonIfExists<PackageManifest>(
        path.join(this.rootDir, relativePath),
      );
      result[key] = { version: manifest?.version ?? UNKNOWN };
    }
    return result;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  const text = await readTextIfExists(filePath);
  return text ? (JSON.parse(text) as T) : null;
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function component(
  key: string,
  label: string,
  rawVersion: string | undefined,
  source: SystemVersionSource,
): SystemVersionComponentDto {
  const version = valueOrUnknown(rawVersion);
  return {
    key,
    label,
    version,
    source,
    status: version === UNKNOWN ? 'unknown' : 'ok',
  };
}

function dependencyVersion(manifest: PackageManifest | null, key: string): string {
  return manifest?.dependencies?.[key] ?? manifest?.devDependencies?.[key] ?? UNKNOWN;
}

function valueOrUnknown(value: string | undefined): string {
  return typeof value === 'string' && value.trim() ? value.trim() : UNKNOWN;
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
