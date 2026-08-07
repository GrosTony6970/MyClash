import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const composePath = path.join(rootDir, 'infra', 'docker-compose.prod.yml');
const devComposePath = path.join(rootDir, 'infra', 'docker-compose.dev.yml');
const deployPath = path.join(rootDir, 'infra', 'scripts', 'deploy.sh');
const redeployPath = path.join(rootDir, 'infra', 'scripts', 'redeploy.sh');
const statusPath = path.join(rootDir, 'infra', 'scripts', 'status.sh');
const startPath = path.join(rootDir, 'infra', 'scripts', 'start.sh');
const traefikEnvLibPath = path.join(rootDir, 'infra', 'scripts', 'lib', 'traefik-env.sh');
const devTraefikStaticPath = path.join(rootDir, 'infra', 'traefik', 'traefik.dev.yml');
const devTraefikDynamicPath = path.join(rootDir, 'infra', 'traefik', 'dynamic.dev.yml');
const vpsBootstrapPath = path.join(rootDir, 'infra', 'scripts', 'vps-bootstrap.sh');
const publicRootPagePath = path.join(rootDir, 'apps', 'web-public', 'app', 'page.tsx');
const publicLoginPagePath = path.join(rootDir, 'apps', 'web-public', 'app', 'login', 'page.tsx');
const publicOAuthCallbackPath = path.join(
  rootDir,
  'apps',
  'web-public',
  'app',
  'auth',
  'oauth',
  'callback',
  'page.tsx',
);
const publicPersonalLayoutPath = path.join(
  rootDir,
  'apps',
  'web-public',
  'app',
  'me',
  'layout.tsx',
);
const publicPersonalPagePath = path.join(rootDir, 'apps', 'web-public', 'app', 'me', 'page.tsx');
const publicPersonalDashboardPath = path.join(
  rootDir,
  'apps',
  'web-public',
  'app',
  'me',
  'PersonalSpaceDashboard.tsx',
);
const publicPersonalShellPath = path.join(
  rootDir,
  'apps',
  'web-public',
  'src',
  'components',
  'PublicPersonalShell.tsx',
);
const publicEventRootPagePath = path.join(
  rootDir,
  'apps',
  'web-public',
  'app',
  'e',
  '[eventSlug]',
  'page.tsx',
);
const adminRootPagePath = path.join(rootDir, 'apps', 'web-admin', 'app', 'page.tsx');
const adminDashboardPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'dashboard',
  'page.tsx',
);
const bootstrapSuperAdminScriptPath = path.join(rootDir, 'scripts', 'bootstrap-super-admin.mjs');
const seedMinScriptPath = path.join(rootDir, 'scripts', 'seed-min.ts');
const superAdminPagePath = path.join(rootDir, 'apps', 'web-admin', 'app', 'admin', 'page.tsx');
const superAdminOrganizationsPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'admin',
  'organizations',
  'page.tsx',
);
const superAdminOrganizationDetailPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'admin',
  'organizations',
  '[id]',
  'page.tsx',
);
const superAdminUsersPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'admin',
  'users',
  'page.tsx',
);
const usersConsoleDir = [rootDir, 'apps', 'web-admin', 'app', 'admin', 'users'];
const accountsPanelPath = path.join(...usersConsoleDir, 'AccountsPanel.tsx');
const accountsTablePath = path.join(...usersConsoleDir, 'AccountsTable.tsx');
const createPlatformAccountFormPath = path.join(
  ...usersConsoleDir,
  'CreatePlatformAccountForm.tsx',
);
const useAdminUsersPath = path.join(...usersConsoleDir, 'useAdminUsers.ts');
const superAdminFightersPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'admin',
  'fighters',
  'page.tsx',
);
const superAdminClubsPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'admin',
  'clubs',
  'page.tsx',
);
const superAdminBackupsPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'admin',
  'backups',
  'page.tsx',
);
const superAdminSystemVersionsPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'admin',
  'system-versions',
  'page.tsx',
);
const adminSystemVersionsServicePath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'admin',
  'system-versions.service.ts',
);
const superAdminLayoutPath = path.join(rootDir, 'apps', 'web-admin', 'app', 'admin', 'layout.tsx');
const superAdminShellPath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'src',
  'components',
  'SuperAdminShell.tsx',
);
const organizerLayoutPath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'org',
  '[slug]',
  'layout.tsx',
);
const organizerShellPath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'src',
  'components',
  'OrganizerAdminShell.tsx',
);
const organizerDashboardPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'org',
  '[slug]',
  'page.tsx',
);
const organizerEventsPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'org',
  '[slug]',
  'events',
  'page.tsx',
);
const organizerEventPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'org',
  '[slug]',
  'events',
  '[eventId]',
  'page.tsx',
);
const organizerNewTournamentPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'org',
  '[slug]',
  'events',
  '[eventId]',
  'tournaments',
  'new',
  '_wizard',
  'Step1Basics.tsx',
);
const organizerEventClubsPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'org',
  '[slug]',
  'events',
  '[eventId]',
  'clubs',
  'page.tsx',
);
const organizerAiSettingsPagePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'app',
  'org',
  '[slug]',
  'settings',
  'ai',
  'page.tsx',
);
const authServicePath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'auth',
  'auth.service.ts',
);
const appModulePath = path.join(rootDir, 'apps', 'api', 'src', 'app.module.ts');
const authControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'auth',
  'auth.controller.ts',
);
const signupControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'auth',
  'signup.controller.ts',
);
const supabaseServicePath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'supabase',
  'supabase.service.ts',
);
const compensationControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'compensation',
  'compensation.controller.ts',
);
const leaguesControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'leagues',
  'leagues.controller.ts',
);
const fightersControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'fighters',
  'fighters.controller.ts',
);
const clubsControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'clubs',
  'clubs.controller.ts',
);
const eventsControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'events',
  'events.controller.ts',
);
const eventsServicePath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'events',
  'events.service.ts',
);
const adminBackupsControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'admin',
  'backups.controller.ts',
);
const adminBackupsServicePath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'admin',
  'backups.service.ts',
);
const opsRunnerServerPath = path.join(rootDir, 'infra', 'ops-runner', 'server.mjs');
const opsRunnerBackupCorePath = path.join(rootDir, 'infra', 'ops-runner', 'backup-core.mjs');
const platformRoleGuardPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'admin',
  'guards',
  'platform-role.guard.ts',
);
const adminDashboardStatsControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'admin',
  'dashboard-stats.controller.ts',
);
const adminOrganizationsControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'admin',
  'organizations.controller.ts',
);
const adminOrganizationsServicePath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'admin',
  'admin-organizations.service.ts',
);
const adminUsersControllerPath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'admin',
  'users.controller.ts',
);
const adminUsersServicePath = path.join(
  rootDir,
  'apps',
  'api',
  'src',
  'modules',
  'admin',
  'admin-users.service.ts',
);
const i18nPath = path.join(rootDir, 'packages', 'i18n', 'src', 'index.ts');
const traefikMiddlewarePath = path.join(rootDir, 'infra', 'config', 'traefik', 'middlewares.yml');
const stagingCertsComposePath = path.join(rootDir, 'infra', 'docker-compose.staging-certs.yml');
const realtimeInitPath = path.join(rootDir, 'infra', 'db', 'init', '02-supabase-realtime.sh');
const realtimeMigrationPath = path.join(
  rootDir,
  'packages',
  'db',
  'migrations',
  '0035_realtime_internal_schema.sql',
);
const clubArchivingMigrationPath = path.join(
  rootDir,
  'packages',
  'db',
  'migrations',
  '0036_club_archiving.sql',
);
const clubReviewRequestsMigrationPath = path.join(
  rootDir,
  'packages',
  'db',
  'migrations',
  '0037_club_review_requests.sql',
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
const redeployText = await readFile(redeployPath, 'utf8');
const statusText = await readFile(statusPath, 'utf8');
const vpsBootstrapText = await readFile(vpsBootstrapPath, 'utf8');
const publicRootPageText = await readFile(publicRootPagePath, 'utf8');
const publicLoginPageText = await readFile(publicLoginPagePath, 'utf8');
const publicOAuthCallbackText = await readFile(publicOAuthCallbackPath, 'utf8');
const publicPersonalLayoutText = await readFile(publicPersonalLayoutPath, 'utf8');
const publicPersonalPageText = await readFile(publicPersonalPagePath, 'utf8');
const publicPersonalDashboardText = await readFile(publicPersonalDashboardPath, 'utf8');
const publicPersonalShellText = await readFile(publicPersonalShellPath, 'utf8');
const publicEventRootPageText = await readFile(publicEventRootPagePath, 'utf8');
const adminRootPageText = await readFile(adminRootPagePath, 'utf8');
const adminDashboardPageText = await readFile(adminDashboardPagePath, 'utf8');
const bootstrapSuperAdminScriptText = await readFile(bootstrapSuperAdminScriptPath, 'utf8');
const seedMinScriptText = await readFile(seedMinScriptPath, 'utf8');
const superAdminPageText = await readFile(superAdminPagePath, 'utf8');
const superAdminOrganizationsPageText = await readFile(superAdminOrganizationsPagePath, 'utf8');
const superAdminOrganizationDetailPageText = await readFile(
  superAdminOrganizationDetailPagePath,
  'utf8',
);
const superAdminUsersPageText = await readFile(superAdminUsersPagePath, 'utf8');
const accountsPanelText = await readFile(accountsPanelPath, 'utf8');
const accountsTableText = await readFile(accountsTablePath, 'utf8');
const createPlatformAccountFormText = await readFile(createPlatformAccountFormPath, 'utf8');
const useAdminUsersText = await readFile(useAdminUsersPath, 'utf8');
const superAdminFightersPageText = await readFile(superAdminFightersPagePath, 'utf8');
const superAdminClubsPageText = await readFile(superAdminClubsPagePath, 'utf8');
const superAdminBackupsPageText = await readFile(superAdminBackupsPagePath, 'utf8');
const superAdminSystemVersionsPageText = await readFile(superAdminSystemVersionsPagePath, 'utf8');
const adminSystemVersionsServiceText = await readFile(adminSystemVersionsServicePath, 'utf8');
const superAdminLayoutText = await readFile(superAdminLayoutPath, 'utf8');
const superAdminShellText = await readFile(superAdminShellPath, 'utf8');
const organizerLayoutText = await readFile(organizerLayoutPath, 'utf8');
const organizerShellText = await readFile(organizerShellPath, 'utf8');
const organizerDashboardPageText = await readFile(organizerDashboardPagePath, 'utf8');
const organizerEventsPageText = await readFile(organizerEventsPagePath, 'utf8');
const organizerEventPageText = await readFile(organizerEventPagePath, 'utf8');
const organizerEventClubsPageText = await readFile(organizerEventClubsPagePath, 'utf8');
const organizerNewTournamentPageText = await readFile(organizerNewTournamentPagePath, 'utf8');
const organizerAiSettingsPageText = await readFile(organizerAiSettingsPagePath, 'utf8');
const appModuleText = await readFile(appModulePath, 'utf8');
const authControllerText = await readFile(authControllerPath, 'utf8');
const signupControllerText = await readFile(signupControllerPath, 'utf8');
const authServiceText = await readFile(authServicePath, 'utf8');
const supabaseServiceText = await readFile(supabaseServicePath, 'utf8');
const compensationControllerText = await readFile(compensationControllerPath, 'utf8');
const leaguesControllerText = await readFile(leaguesControllerPath, 'utf8');
const fightersControllerText = await readFile(fightersControllerPath, 'utf8');
const clubsControllerText = await readFile(clubsControllerPath, 'utf8');
const eventsControllerText = await readFile(eventsControllerPath, 'utf8');
const eventsServiceText = await readFile(eventsServicePath, 'utf8');
const adminBackupsControllerText = await readFile(adminBackupsControllerPath, 'utf8');
const adminBackupsServiceText = await readFile(adminBackupsServicePath, 'utf8');
const opsRunnerServerText = await readFile(opsRunnerServerPath, 'utf8');
const opsRunnerBackupCoreText = await readFile(opsRunnerBackupCorePath, 'utf8');
const platformRoleGuardText = await readFile(platformRoleGuardPath, 'utf8');
const adminDashboardStatsControllerText = await readFile(adminDashboardStatsControllerPath, 'utf8');
const adminOrganizationsControllerText = await readFile(adminOrganizationsControllerPath, 'utf8');
const adminOrganizationsServiceText = await readFile(adminOrganizationsServicePath, 'utf8');
const adminUsersControllerText = await readFile(adminUsersControllerPath, 'utf8');
const adminUsersServiceText = await readFile(adminUsersServicePath, 'utf8');
const i18nText = await readFile(i18nPath, 'utf8');
const traefikMiddlewareText = await readFile(traefikMiddlewarePath, 'utf8');
const startText = await readFile(startPath, 'utf8');
const traefikEnvLibText = await readFile(traefikEnvLibPath, 'utf8');
const devTraefikStaticText = await readFile(devTraefikStaticPath, 'utf8');
const devTraefikDynamicText = await readFile(devTraefikDynamicPath, 'utf8');
const stagingCertsComposeText = await readFile(stagingCertsComposePath, 'utf8');
const realtimeInitText = await readFile(realtimeInitPath, 'utf8');
const realtimeMigrationText = await readFile(realtimeMigrationPath, 'utf8');
const clubArchivingMigrationText = await readFile(clubArchivingMigrationPath, 'utf8');
const clubReviewRequestsMigrationText = await readFile(clubReviewRequestsMigrationPath, 'utf8');
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
  'supabase-meta',
  'supabase-studio',
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

  if (!['worker', 'supabase-rest'].includes(serviceName)) {
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

  // postgres-meta answers unauthenticated and speaks to Postgres as the
  // superuser. Studio reaching it over the compose network is the only intended
  // path; a router here would publish an unauthenticated DDL API.
  if (serviceName === 'supabase-meta' && /traefik\.http\.routers\./.test(service)) {
    errors.push('supabase-meta must remain internal-only and must not define Traefik routers.');
  }
}

/**
 * supabase/realtime is multi-tenant and resolves the tenant from the FIRST
 * LABEL of the Host header. Traefik forwards the client's Host untouched, so
 * SELF_HOST_TENANT_NAME must equal that label or the websocket handshake 403s —
 * silently, since the container healthcheck addresses the tenant by path and
 * keeps answering 200. This gate used to pin the literal name `realtime`, which
 * is what the value WAS while every public socket was dead; assert the
 * relationship instead, because that is the thing that has to hold.
 */
function realtimeTenantHost(composeText, wsRouterName) {
  const match = new RegExp(
    `traefik\\.http\\.routers\\.${wsRouterName}\\.rule=Host\\(\`([^\`]+)\`\\)`,
  ).exec(composeText);
  return match?.[1] ?? null;
}

const realtimeTenants = new Map();
for (const [label, service, routerCompose, wsRouterName] of [
  ['prod supabase-realtime', services.get('supabase-realtime'), composeText, 'myclash-realtime'],
  ['dev supabase-realtime', devServices.get('supabase-realtime'), devComposeText, 'dev-realtime'],
]) {
  if (!service) {
    errors.push(`${label} service is missing.`);
    continue;
  }
  requireContains(service, label, "DB_AFTER_CONNECT_QUERY: 'SET search_path TO _realtime'");
  requireContains(service, label, 'DB_ENC_KEY:');
  requireContains(service, label, 'API_JWT_SECRET:');
  requireContains(service, label, "SEED_SELF_HOST: 'true'");

  const tenant = /SELF_HOST_TENANT_NAME:\s*(\S+)/.exec(service)?.[1] ?? null;
  if (!tenant) {
    errors.push(`${label} is missing SELF_HOST_TENANT_NAME.`);
    continue;
  }
  realtimeTenants.set(label, tenant);

  const host = realtimeTenantHost(routerCompose, wsRouterName);
  if (!host) {
    errors.push(`${label}: could not find the ${wsRouterName} router's Host rule.`);
    continue;
  }
  const hostLabel = host.split('.')[0];
  if (tenant !== hostLabel) {
    errors.push(
      `${label} SELF_HOST_TENANT_NAME is "${tenant}" but the ${wsRouterName} router serves ` +
        `Host \`${host}\`, whose first label is "${hostLabel}". Realtime resolves the tenant ` +
        `from that label — every websocket handshake would 403.`,
    );
  }
}
const prodRealtime = services.get('supabase-realtime') ?? '';
requireContains(prodRealtime, 'prod supabase-realtime', 'Authorization: Bearer');
requireContains(
  prodRealtime,
  'prod supabase-realtime',
  `/api/tenants/${realtimeTenants.get('prod supabase-realtime') ?? 'app'}/health`,
);

const prodStorage = services.get('supabase-storage') ?? '';
requireContains(prodStorage, 'prod supabase-storage', 'http://supabase-storage:5000/status');
requireContains(
  prodStorage,
  'prod supabase-storage',
  'supabase-rest: { condition: service_started }',
);

const prodRest = services.get('supabase-rest') ?? '';
if (prodRest.includes('healthcheck:')) {
  errors.push('prod supabase-rest must not define a Docker healthcheck.');
}
for (const forbidden of [
  'CMD-SHELL',
  '/bin/sh',
  '/proc/1/comm',
  '/bin/bash',
  '/dev/tcp',
  'kill -0',
  'curl',
  'wget',
]) {
  if (prodRest.includes(forbidden)) {
    errors.push(`prod supabase-rest healthcheck must not use ${forbidden}.`);
  }
}
if (!devComposeText.includes('DB_ENC_KEY: ${SUPABASE_REALTIME_DB_ENC_KEY:-devrealtimedbkey}')) {
  errors.push('dev supabase-realtime DB_ENC_KEY fallback must be exactly 16 characters.');
}
requireContains(
  services.get('web-public') ?? '',
  'prod web-public',
  'NEXT_PUBLIC_API_URL: https://app.${DOMAIN}',
);
requireContains(
  services.get('web-admin') ?? '',
  'prod web-admin',
  'NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL_ADMIN}',
);
requireContains(
  services.get('api') ?? '',
  'prod api admin same-origin route',
  'traefik.http.routers.myclash-admin-api.rule=Host(`admin.${DOMAIN}`) && PathPrefix(`/api/v1`)',
);
requireContains(
  services.get('api') ?? '',
  'prod api admin same-origin route',
  'traefik.http.routers.myclash-admin-api.priority=30',
);
requireContains(
  devServices.get('web-public') ?? '',
  'dev web-public',
  'NEXT_PUBLIC_API_URL: https://api.myclash.localhost',
);
requireContains(
  devServices.get('web-admin') ?? '',
  'dev web-admin',
  'NEXT_PUBLIC_API_URL: https://admin.myclash.localhost',
);
requireContains(
  devServices.get('api') ?? '',
  'dev api admin same-origin route',
  'traefik.http.routers.dev-admin-api.rule=Host(`admin.myclash.localhost`) && PathPrefix(`/api/v1`)',
);
for (const serviceName of ['api', 'worker']) {
  requireContains(
    services.get(serviceName) ?? '',
    `prod ${serviceName}`,
    'SUPABASE_AUTH_INTERNAL_URL: http://supabase-auth:9999',
  );
}
if (authServiceText.includes('signInWithPassword')) {
  errors.push('AuthService.passwordLogin must use internal GoTrue instead of signInWithPassword.');
}
if (authServiceText.includes('supabase.anon.auth.getUser')) {
  errors.push('AuthService server-side token validation must use internal GoTrue /user.');
}
if (compensationControllerText.includes('supabase.anon.auth.getUser')) {
  errors.push(
    'CompensationController must validate organizer tokens with internal GoTrue, not supabase.anon.auth.getUser.',
  );
}
if (leaguesControllerText.includes('supabase.anon.auth.getUser')) {
  errors.push(
    'LeaguesController must validate admin tokens with internal GoTrue, not supabase.anon.auth.getUser.',
  );
}
requireContains(
  compensationControllerText,
  'apps/api/src/modules/compensation/compensation.controller.ts',
  'supabase.getAuthUser(token)',
);
requireContains(
  leaguesControllerText,
  'apps/api/src/modules/leagues/leagues.controller.ts',
  'supabase.getAuthUser(token)',
);
requireContains(authServiceText, 'AuthService', '/token?grant_type=password');
requireContains(authServiceText, 'AuthService', 'SUPABASE_AUTH_INTERNAL_URL');
requireContains(authServiceText, 'AuthService', 'SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30');
requireContains(authServiceText, 'AuthService', 'maxAge: SESSION_MAX_AGE_SECONDS');
requireContains(supabaseServiceText, 'SupabaseService', '/user');
requireContains(supabaseServiceText, 'SupabaseService', 'SUPABASE_AUTH_INTERNAL_URL');
requireContains(supabaseServiceText, 'SupabaseService', 'getAuthUser');
if (authServiceText.includes('maxAge: 60 * 60 * 24 * 30')) {
  errors.push('AuthService admin refresh cookie must not outlive the one-hour admin session.');
}
if (appModuleText.includes("name: 'auth'")) {
  errors.push(
    'AppModule must not configure auth as a named global throttler; strict auth limits belong on auth endpoints.',
  );
}
for (const expected of ['AUTH_ACTION_THROTTLE', '@Throttle(AUTH_ACTION_THROTTLE)']) {
  requireContains(authControllerText, 'apps/api/src/modules/auth/auth.controller.ts', expected);
}
for (const expected of ['SIGNUP_ACTION_THROTTLE', '@Throttle(SIGNUP_ACTION_THROTTLE)']) {
  requireContains(signupControllerText, 'apps/api/src/modules/auth/signup.controller.ts', expected);
}
requireContains(authServiceText, 'AuthService', 'public_login');
requireContains(authServiceText, 'AuthService', 'getPersonalSpace');
requireContains(authServiceText, 'AuthService', 'api.${domain}');
requireContains(
  composeText,
  'prod GOTRUE_URI_ALLOW_LIST',
  'https://api.${DOMAIN}/api/v1/auth/callback',
);

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

const deployCompleteIndex = deployText.indexOf('hdr "Deploy complete"');
const deploymentSecretsHeaderIndex = deployText.indexOf('hdr "Deployment secrets"');
const deploymentSecretsCallIndex =
  deployCompleteIndex === -1
    ? -1
    : deployText.indexOf('print_deployment_secrets', deployCompleteIndex);
if (deploymentSecretsHeaderIndex === -1) {
  errors.push('deploy.sh must print a final Deployment secrets section.');
}
if (deployCompleteIndex !== -1 && deploymentSecretsCallIndex === -1) {
  errors.push('deploy.sh must print Deployment secrets after the deploy summary.');
}
for (const expected of [
  'print_deployment_secrets',
  'print_secret_key',
  'POSTGRES_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VAPID_PRIVATE_KEY',
  'SEED_ADMIN_PASSWORD',
  'TRAEFIK_DASHBOARD_AUTH',
  'TRAEFIK_DASHBOARD_PASSWORD',
  'STUDIO_BASIC_AUTH',
  'STUDIO_PASSWORD',
  'Generated plaintext credentials (also saved to .env on this server):',
  '${service}_PASSWORD',
]) {
  if (!deployText.includes(expected)) {
    errors.push(`deploy.sh final Deployment secrets section is missing ${expected}.`);
  }
}
// The hash in TRAEFIK_DASHBOARD_AUTH is one-way, so the plaintext is stored
// beside it and deploy.sh must say where — an operator who cannot find the
// dashboard password has no way to derive it.
if (!deployText.includes('is in .env as TRAEFIK_DASHBOARD_PASSWORD')) {
  errors.push('deploy.sh must say where the current Traefik dashboard password is stored.');
}
for (const expected of [
  'PGPASSWORD="$POSTGRES_PASSWORD"',
  'PGCONNECT_TIMEOUT=5',
  "PGOPTIONS='-c statement_timeout=5000'",
  'psql -w -h 127.0.0.1 -tA',
]) {
  if (!statusText.includes(expected)) {
    errors.push(`status.sh Postgres diagnostics must include ${expected}.`);
  }
}
for (const serviceName of [
  'api',
  'worker',
  'web-public',
  'web-scoring',
  'web-admin',
  'web-marketing',
  'db',
  'redis',
  'traefik',
  'ops-runner',
  'supabase-auth',
  'supabase-realtime',
  'supabase-rest',
  'supabase-storage',
]) {
  if (!statusText.includes(serviceName)) {
    errors.push(`status.sh Container health must include ${serviceName}.`);
  }
}
for (const expected of [
  "docker inspect --format='{{json .State.Health.Log}}'",
  "docker inspect --format='{{json .Config.Healthcheck.Test}}'",
  'supabase-rest effective healthcheck',
]) {
  if (!statusText.includes(expected)) {
    errors.push(`status.sh must print health diagnostics with ${expected}.`);
  }
}
for (const expected of [
  'print_service_health_diagnostics supabase-rest supabase-storage',
  "docker inspect --format='  Healthcheck: {{json .Config.Healthcheck.Test}}'",
  "docker inspect --format='  Health log: {{json .State.Health.Log}}'",
]) {
  if (!deployText.includes(expected)) {
    errors.push(`deploy.sh must print compose health diagnostics with ${expected}.`);
  }
}
for (const expected of [
  'mkdir -p data',
  '[[ -d data/system-versions.json ]]',
  'rm -rf -- data/system-versions.json',
  '[[ ! -f data/system-versions.json || ! -s data/system-versions.json ]]',
]) {
  if (!deployText.includes(expected)) {
    errors.push(`deploy.sh system version manifest generation must include ${expected}.`);
  }
}
for (const expected of ['stat.isFile()', 'Source: ${source}', 'Manifest path type: ${type}']) {
  if (!statusText.includes(expected)) {
    errors.push(`status.sh API version diagnostics must tolerate bad manifests with ${expected}.`);
  }
}
for (const [label, text] of [
  ['apps/web-public/app/page.tsx', publicRootPageText],
  ['apps/web-public/app/e/[eventSlug]/page.tsx', publicEventRootPageText],
  ['apps/web-admin/app/page.tsx', adminRootPageText],
  ['packages/i18n/src/index.ts', i18nText],
]) {
  if (/\bT-003\b|Placeholder -|scaffold|port 300[13]/u.test(text)) {
    errors.push(`${label} must not expose the old T-003 scaffold root-page copy.`);
  }
}
if (publicRootPageText.includes('publicApp.home.placeholder')) {
  errors.push('apps/web-public/app/page.tsx must not render publicApp.home.placeholder.');
}
requireContains(publicLoginPageText, 'apps/web-public/app/login/page.tsx', "type: 'public_login'");
requireContains(publicLoginPageText, 'apps/web-public/app/login/page.tsx', 'signInWithOAuth');
requireContains(
  publicOAuthCallbackText,
  'apps/web-public/app/auth/oauth/callback/page.tsx',
  'public_login',
);
requireContains(
  publicPersonalLayoutText,
  'apps/web-public/app/me/layout.tsx',
  'PublicPersonalShell',
);
requireContains(
  publicPersonalPageText,
  'apps/web-public/app/me/page.tsx',
  'PersonalSpaceDashboard',
);
requireContains(
  publicPersonalDashboardText,
  'apps/web-public/app/me/PersonalSpaceDashboard.tsx',
  '/api/v1/me/personal-space',
);
requireContains(
  publicPersonalShellText,
  'apps/web-public/src/components/PublicPersonalShell.tsx',
  '/api/v1/me',
);
requireContains(
  publicPersonalShellText,
  'apps/web-public/src/components/PublicPersonalShell.tsx',
  '/api/v1/auth/logout',
);
requireContains(
  publicPersonalShellText,
  'apps/web-public/src/components/PublicPersonalShell.tsx',
  "window.location.replace('/login')",
);
/**
 * App chrome must be STICKY, never FIXED.
 *
 * a1a90ffc moved all three sidebar shells off `fixed inset-y-0 left-0`: fixed
 * chrome ignores document flow, so the banners the root layout renders above
 * the shell (maintenance, legal update) were painted over by the header and the
 * sidebar. This gate pinned the OLD string, so it went red the moment that was
 * fixed and stayed red — while never covering OrganizerAdminShell at all, the
 * very shell the other two cite as their reference.
 *
 * So assert the invariant, not the snapshot: sticky present, `fixed inset-y-0`
 * absent. Matched exactly — the mobile drawer's `fixed inset-0 z-overlay` and
 * the skip-link's `focus:fixed` are correct and must not trip it.
 *
 * LeagueWorkspaceShell is not here on purpose: it is header-only and delegates
 * the aside to its parent shell.
 */
for (const [label, text] of [
  ['apps/web-public/src/components/PublicPersonalShell.tsx', publicPersonalShellText],
  ['apps/web-admin/src/components/SuperAdminShell.tsx', superAdminShellText],
  ['apps/web-admin/src/components/OrganizerAdminShell.tsx', organizerShellText],
]) {
  requireContains(text, label, 'sticky top-0 z-sidebar');
  requireContains(text, label, 'sticky top-0 z-header');
  if (/fixed inset-y-0/u.test(text)) {
    errors.push(
      `${label} must keep its chrome sticky, not fixed — \`fixed inset-y-0\` ignores document ` +
        `flow and paints over the root layout's banners (see a1a90ffc).`,
    );
  }
}
for (const [label, text] of [
  ['apps/web-public/app/login/page.tsx', publicLoginPageText],
  ['apps/web-public/app/me/PersonalSpaceDashboard.tsx', publicPersonalDashboardText],
  ['apps/web-public/src/components/PublicPersonalShell.tsx', publicPersonalShellText],
]) {
  if (/SERVICE_ROLE|SEED_ADMIN|SUPABASE_SERVICE_ROLE_KEY/u.test(text)) {
    errors.push(`${label} must not expose service-role or seed-admin secrets.`);
  }
}
if (adminRootPageText.includes('admin.home.placeholder')) {
  errors.push('apps/web-admin/app/page.tsx must not render admin.home.placeholder.');
}
requireContains(
  publicEventRootPageText,
  'apps/web-public/app/e/[eventSlug]/page.tsx',
  'redirect(`/e/${eventSlug}/home`)',
);
// The routing lives in resolveLanding() (a discriminated-union resolver) rather
// than inline window.location writes: super-admins with no org → /admin,
// org members → their org, dual-role (super-admin + org) → the workspace
// chooser, and the terminal no-workspace state. Assert the resolver's shape.
requireContains(
  adminDashboardPageText,
  'apps/web-admin/app/dashboard/page.tsx',
  'data.admin?.platformRole',
);
requireContains(adminDashboardPageText, 'apps/web-admin/app/dashboard/page.tsx', "href: '/admin'");
requireContains(
  adminDashboardPageText,
  'apps/web-admin/app/dashboard/page.tsx',
  'href: `/org/${firstOrg.slug}`',
);
requireContains(adminDashboardPageText, 'apps/web-admin/app/dashboard/page.tsx', "kind: 'chooser'");
requireContains(
  adminDashboardPageText,
  'apps/web-admin/app/dashboard/page.tsx',
  "setMode('noWorkspace')",
);
if (
  /T-105 follow-up|Org slug lookup will be wired|Redirecting to your dashboard[â€¦…]/u.test(
    adminDashboardPageText,
  )
) {
  errors.push(
    'apps/web-admin/app/dashboard/page.tsx must not leave authenticated users on the old endless redirect placeholder.',
  );
}
// The seed scripts must NOT make the bootstrap super admin an org member. That
// row contradicts the API invariant (OrganizationsService.assertNotSuperAdmin /
// AdminUsersService.assertNotSuperAdmin) and made the super admin land on the
// dual-role workspace chooser instead of /admin. They un-seed it instead.
for (const [label, text] of [
  ['scripts/bootstrap-super-admin.mjs', bootstrapSuperAdminScriptText],
  ['scripts/seed-min.ts', seedMinScriptText],
]) {
  requireContains(text, label, 'DELETE FROM organization_members');
  if (/INSERT INTO organization_members/u.test(text)) {
    errors.push(
      `${label} must not grant the super admin an organization membership — a super-admin is platform-scoped (see OrganizationsService.assertNotSuperAdmin).`,
    );
  }
}
requireContains(
  authServiceText,
  'apps/api/src/modules/auth/auth.service.ts',
  'getAdminLandingContext',
);
// The table name no longer appears here: every platform-role lookup goes
// through common/auth/platform-role.ts, which is the point of that module.
requireContains(
  authServiceText,
  'apps/api/src/modules/auth/auth.service.ts',
  'common/auth/platform-role',
);
requireContains(
  authServiceText,
  'apps/api/src/modules/auth/auth.service.ts',
  'organization_members',
);
requireContains(
  platformRoleGuardText,
  'apps/api/src/modules/admin/guards/platform-role.guard.ts',
  'SUPABASE_AUTH_INTERNAL_URL',
);
requireContains(
  platformRoleGuardText,
  'apps/api/src/modules/admin/guards/platform-role.guard.ts',
  '/user',
);
if (platformRoleGuardText.includes('supabase.anon.auth.getUser')) {
  errors.push(
    'PlatformRoleGuard must validate server-side admin tokens with internal GoTrue, not supabase.anon.auth.getUser.',
  );
}
requireContains(superAdminLayoutText, 'apps/web-admin/app/admin/layout.tsx', 'SuperAdminShell');
requireContains(
  superAdminShellText,
  'apps/web-admin/src/components/SuperAdminShell.tsx',
  'usePathname',
);
// Chrome layout for this shell is asserted with the other two above — see the
// sticky-not-fixed block.
requireContains(
  superAdminShellText,
  'apps/web-admin/src/components/SuperAdminShell.tsx',
  '/api/v1/auth/logout',
);
requireContains(
  superAdminShellText,
  'apps/web-admin/src/components/SuperAdminShell.tsx',
  "credentials: 'include'",
);
requireContains(
  superAdminShellText,
  'apps/web-admin/src/components/SuperAdminShell.tsx',
  'admin.shell.logout',
);
requireContains(
  superAdminShellText,
  'apps/web-admin/src/components/SuperAdminShell.tsx',
  'admin.shell.loggingOut',
);
requireContains(
  superAdminShellText,
  'apps/web-admin/src/components/SuperAdminShell.tsx',
  '/api/v1/me',
);
requireContains(
  superAdminShellText,
  'apps/web-admin/src/components/SuperAdminShell.tsx',
  "window.location.replace('/login')",
);
requireContains(
  organizerLayoutText,
  'apps/web-admin/app/org/[slug]/layout.tsx',
  'OrganizerAdminShell',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  'usePathname',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  'useParams',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  '/api/v1/auth/logout',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  "credentials: 'include'",
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  'organizer.shell.logout',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  '/api/v1/me',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  "window.location.replace('/login')",
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  'eventNavItems',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  'eventId',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  "href: 'events'",
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  'organizer.shell.nav.events',
);
requireContains(
  organizerDashboardPageText,
  'apps/web-admin/app/org/[slug]/page.tsx',
  '/dashboard-stats',
);
requireContains(
  organizerDashboardPageText,
  'apps/web-admin/app/org/[slug]/page.tsx',
  'organizer.dashboard.metrics.eventsCreated',
);
requireContains(
  organizerDashboardPageText,
  'apps/web-admin/app/org/[slug]/page.tsx',
  'organizer.dashboard.metrics.fighters',
);
if (organizerDashboardPageText.includes('tournamentCount')) {
  errors.push(
    'apps/web-admin/app/org/[slug]/page.tsx must be a metrics dashboard, not the event table.',
  );
}
requireContains(
  organizerEventsPageText,
  'apps/web-admin/app/org/[slug]/events/page.tsx',
  '/events/${event.id}',
);
requireContains(
  organizerEventsPageText,
  'apps/web-admin/app/org/[slug]/events/page.tsx',
  "method: 'PATCH'",
);
requireContains(
  organizerEventsPageText,
  'apps/web-admin/app/org/[slug]/events/page.tsx',
  "method: 'DELETE'",
);
requireContains(
  organizerEventsPageText,
  'apps/web-admin/app/org/[slug]/events/page.tsx',
  'mode=hard',
);
// Tournament-create flow moved from the new/page.tsx shim into the wizard's
// Step 1 (the shim is now a thin WizardShell wrapper) — assert it there.
requireContains(
  organizerNewTournamentPageText,
  'apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step1Basics.tsx',
  '/api/v1/events/${eventId}/tournaments',
);
requireContains(
  organizerNewTournamentPageText,
  'apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step1Basics.tsx',
  "useState('TF_v1')",
);
requireContains(
  organizerNewTournamentPageText,
  'apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step1Basics.tsx',
  'slugify',
);
for (const expected of [
  '/dashboard-stats',
  'organizer.eventHub.dashboard.title',
  'organizer.eventHub.aiBudget',
]) {
  requireContains(
    organizerEventPageText,
    'apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx',
    expected,
  );
}
// Clubs section was extracted from the event dashboard into a dedicated
// /clubs sub-page — assert its endpoints + labels there.
for (const expected of [
  '/clubs?',
  '/club-requests',
  'organizer.eventHub.clubs.allClubs',
  'organizer.eventHub.clubs.eventClubs',
  'organizer.eventHub.clubs.viewFighters',
]) {
  requireContains(
    organizerEventClubsPageText,
    'apps/web-admin/app/org/[slug]/events/[eventId]/clubs/page.tsx',
    expected,
  );
}
if (organizerEventPageText.includes('const sections = [')) {
  errors.push(
    'apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx must render an event dashboard, not the old internal menu-card grid.',
  );
}
if (organizerAiSettingsPageText.includes('settings/compensation')) {
  errors.push(
    'apps/web-admin/app/org/[slug]/settings/ai/page.tsx must not show compensation settings links inside AI settings.',
  );
}
requireContains(
  superAdminPageText,
  'apps/web-admin/app/admin/page.tsx',
  '/api/v1/admin/dashboard-stats',
);
requireContains(superAdminPageText, 'apps/web-admin/app/admin/page.tsx', "credentials: 'include'");
requireContains(
  superAdminPageText,
  'apps/web-admin/app/admin/page.tsx',
  'admin.dashboard.section.platform',
);
requireContains(
  superAdminOrganizationsPageText,
  'apps/web-admin/app/admin/organizations/page.tsx',
  '/api/v1/admin/organizations',
);
requireContains(
  superAdminOrganizationsPageText,
  'apps/web-admin/app/admin/organizations/page.tsx',
  'admin.organizations.create.open',
);
requireContains(
  superAdminOrganizationsPageText,
  'apps/web-admin/app/admin/organizations/page.tsx',
  'temporaryPassword',
);
for (const forbidden of ['SUPABASE_SERVICE_ROLE_KEY', 'service_role', 'SEED_ADMIN_PASSWORD']) {
  if (superAdminOrganizationsPageText.includes(forbidden)) {
    errors.push(`apps/web-admin/app/admin/organizations/page.tsx must not expose ${forbidden}.`);
  }
}
requireContains(
  adminOrganizationsControllerText,
  'apps/api/src/modules/admin/organizations.controller.ts',
  '@UseGuards(PlatformRoleGuard)',
);
requireContains(
  adminOrganizationsControllerText,
  'apps/api/src/modules/admin/organizations.controller.ts',
  '@Post()',
);
requireContains(
  adminOrganizationsServiceText,
  'apps/api/src/modules/admin/admin-organizations.service.ts',
  'createOrganizationWithOwner',
);
requireContains(
  adminOrganizationsServiceText,
  'apps/api/src/modules/admin/admin-organizations.service.ts',
  'email_confirm: true',
);
requireContains(
  adminOrganizationsServiceText,
  'apps/api/src/modules/admin/admin-organizations.service.ts',
  'org.create_with_owner',
);
requireContains(
  adminOrganizationsServiceText,
  'apps/api/src/modules/admin/admin-organizations.service.ts',
  "PROTECTED_ORG_SLUG = 'myclash-hq'",
);
requireContains(
  adminOrganizationsServiceText,
  'apps/api/src/modules/admin/admin-organizations.service.ts',
  'is_protected',
);
requireContains(
  adminOrganizationsServiceText,
  'apps/api/src/modules/admin/admin-organizations.service.ts',
  'getAuthUserDisplayMap',
);
requireContains(
  adminOrganizationsServiceText,
  'apps/api/src/modules/admin/admin-organizations.service.ts',
  'The MyClash HQ organization cannot be deleted',
);
requireContains(
  adminOrganizationsServiceText,
  'apps/api/src/modules/admin/admin-organizations.service.ts',
  'The MyClash HQ organization cannot be suspended',
);
requireContains(
  adminOrganizationsServiceText,
  'apps/api/src/modules/admin/admin-organizations.service.ts',
  'ensureOrganizationCanBeSuspended',
);
for (const expected of ['owner_username', 'display_name', 'username']) {
  requireContains(
    adminOrganizationsServiceText,
    'apps/api/src/modules/admin/admin-organizations.service.ts',
    expected,
  );
}
for (const expected of ['is_protected', 'owner_username', 'actions.protected']) {
  requireContains(
    superAdminOrganizationsPageText,
    'apps/web-admin/app/admin/organizations/page.tsx',
    expected,
  );
}
for (const expected of [
  'is_protected',
  'member.username',
  'member.email',
  'member.user_id',
  'protectedNote',
  'selectOwnerTitle',
  'loadPlatformAccounts',
  '/api/v1/admin/users?',
  'account.id',
]) {
  requireContains(
    superAdminOrganizationDetailPageText,
    'apps/web-admin/app/admin/organizations/[id]/page.tsx',
    expected,
  );
}
if (superAdminOrganizationDetailPageText.includes('prompt(')) {
  errors.push(
    'apps/web-admin/app/admin/organizations/[id]/page.tsx must use searchable member/account pickers instead of prompt().',
  );
}
for (const forbidden of [
  'auth.admin.listUsers',
  'auth.admin.createUser',
  'auth.admin.deleteUser',
]) {
  if (adminOrganizationsServiceText.includes(forbidden)) {
    errors.push(
      `apps/api/src/modules/admin/admin-organizations.service.ts must use internal GoTrue helpers instead of ${forbidden}.`,
    );
  }
}
for (const expected of ['listAuthAdminUsers', 'createAuthAdminUser', 'deleteAuthAdminUser']) {
  requireContains(
    adminOrganizationsServiceText,
    'apps/api/src/modules/admin/admin-organizations.service.ts',
    expected,
  );
  requireContains(
    supabaseServiceText,
    'apps/api/src/modules/supabase/supabase.service.ts',
    expected,
  );
}
requireContains(
  adminUsersControllerText,
  'apps/api/src/modules/admin/users.controller.ts',
  '@UseGuards(PlatformRoleGuard)',
);
for (const expected of ['@Post()', "@Delete(':id')", 'CreatePlatformUserDto', 'mode']) {
  requireContains(
    adminUsersControllerText,
    'apps/api/src/modules/admin/users.controller.ts',
    expected,
  );
}
for (const expected of ['ADMIN_READ_THROTTLE', '@Throttle(ADMIN_READ_THROTTLE)']) {
  requireContains(
    adminUsersControllerText,
    'apps/api/src/modules/admin/users.controller.ts',
    expected,
  );
}
for (const forbidden of [
  'auth.admin.listUsers',
  'auth.admin.createUser',
  'auth.admin.updateUserById',
  'auth.admin.getUserById',
  'auth.admin.deleteUser',
]) {
  if (adminUsersServiceText.includes(forbidden)) {
    errors.push(
      `apps/api/src/modules/admin/admin-users.service.ts must use internal GoTrue helpers instead of ${forbidden}.`,
    );
  }
}
for (const expected of [
  'createPlatformUser',
  'deletePlatformUser',
  'listAuthAdminUsers',
  'createAuthAdminUser',
  'updateAuthAdminUser',
  'deleteAuthAdminUser',
  'display_name: this.normalizeDisplayName(user)',
  'You cannot delete your own account',
  'last remaining super admin',
  'cleanupUserReferences',
]) {
  requireContains(
    adminUsersServiceText,
    'apps/api/src/modules/admin/admin-users.service.ts',
    expected,
  );
}
// The console is a shell plus components, so each assertion is checked against
// the file that now owns it. The page itself only owns the tab split.
for (const expected of ['SegmentedTabs', 'admin.users.tabs.platform', 'AccountsPanel']) {
  requireContains(superAdminUsersPageText, 'apps/web-admin/app/admin/users/page.tsx', expected);
}
for (const expected of ['/api/v1/admin/users', 'common.tooManyRequests', 'actions.retry']) {
  requireContains(accountsPanelText, 'apps/web-admin/app/admin/users/AccountsPanel.tsx', expected);
}
for (const expected of [
  'admin.users.table.displayName',
  'admin.users.actions.enableHelp',
  'admin.users.actions.disableHelp',
  'admin.users.actions.safeDelete',
  'admin.users.actions.safeDeleteHelp',
  'admin.users.actions.cleanupDelete',
  'admin.users.actions.cleanupDeleteHelp',
  'title={description}',
  'aria-label={`${label}: ${description}`}',
  // Both delete modes must stay reachable from a row; safe-only would quietly
  // remove the operator's escape hatch for an account with references.
  "onDelete(user, 'safe')",
  "onDelete(user, 'cleanup')",
]) {
  requireContains(accountsTableText, 'apps/web-admin/app/admin/users/AccountsTable.tsx', expected);
}
for (const expected of ['/api/v1/admin/users', 'temporaryPassword', 'admin.users.create']) {
  requireContains(
    createPlatformAccountFormText,
    'apps/web-admin/app/admin/users/CreatePlatformAccountForm.tsx',
    expected,
  );
}
for (const expected of [
  'Platform accounts',
  "displayName: 'Display name'",
  'enableHelp',
  'disableHelp',
  'safeDeleteHelp',
  'cleanupDeleteHelp',
]) {
  requireContains(i18nText, 'packages/i18n/src/index.ts', expected);
}
for (const forbidden of ['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE', 'SEED_ADMIN_PASSWORD']) {
  for (const [label, text] of [
    ['apps/web-admin/app/admin/users/page.tsx', superAdminUsersPageText],
    ['apps/web-admin/app/admin/users/AccountsPanel.tsx', accountsPanelText],
    ['apps/web-admin/app/admin/users/AccountsTable.tsx', accountsTableText],
    ['apps/web-admin/app/admin/users/CreatePlatformAccountForm.tsx', createPlatformAccountFormText],
    ['apps/web-admin/app/admin/users/useAdminUsers.ts', useAdminUsersText],
  ]) {
    if (text.includes(forbidden)) {
      errors.push(`${label} must not expose ${forbidden}.`);
    }
  }
}
for (const expected of [
  "@Patch(':id')",
  '@UseGuards(PlatformRoleGuard)',
  'updateGlobalPerson',
  'ADMIN_READ_THROTTLE',
  'CATALOG_READ_THROTTLE',
  '@Throttle(ADMIN_READ_THROTTLE)',
  '@Throttle(CATALOG_READ_THROTTLE)',
]) {
  requireContains(
    fightersControllerText,
    'apps/api/src/modules/fighters/fighters.controller.ts',
    expected,
  );
}
for (const expected of [
  'startEditProfile',
  'admin.globalProfiles.clubCreateFromSearch',
  'searchAbv=true',
  'admin.globalProfiles.hemaRatingsId',
  'admin.globalProfiles.requiredNote',
  'common.tooManyRequests',
  'actions.retry',
]) {
  requireContains(
    superAdminFightersPageText,
    'apps/web-admin/app/admin/fighters/page.tsx',
    expected,
  );
}
for (const expected of [
  'createClub',
  '/api/v1/clubs',
  'admin.clubs.createTitle',
  'admin.clubs.logoUpload',
  '/api/v1/clubs/${clubId}/logo',
  'MAX_LOGO_BYTES = 10 * 1024 * 1024',
  '/api/v1/clubs/review-requests',
  'admin.clubs.requestsTitle',
  'approve',
  'link',
  'reject',
]) {
  requireContains(superAdminClubsPageText, 'apps/web-admin/app/admin/clubs/page.tsx', expected);
}
for (const expected of ['/admin/clubs', 'admin.shell.nav.clubs']) {
  requireContains(
    superAdminShellText,
    'apps/web-admin/src/components/SuperAdminShell.tsx',
    expected,
  );
}
if (
  superAdminShellText.indexOf("href: '/admin/clubs'") >
  superAdminShellText.indexOf("href: '/admin/leagues'")
) {
  errors.push(
    'apps/web-admin/src/components/SuperAdminShell.tsx must keep Leagues immediately after Clubs in the super-admin sidebar.',
  );
}
if (
  superAdminPageText.indexOf("href: '/admin/clubs'") >
  superAdminPageText.indexOf("href: '/admin/leagues'")
) {
  errors.push(
    'apps/web-admin/app/admin/page.tsx must keep the Leagues card immediately after Clubs.',
  );
}
for (const expected of [
  "@Delete(':id')",
  "@Post(':id/logo')",
  "@Get('review-requests')",
  "@Post('review-requests/:id/approve')",
  "@Post('review-requests/:id/link')",
  "@Post('review-requests/:id/reject')",
  '@UseGuards(PlatformRoleGuard)',
  'CATALOG_READ_THROTTLE',
  '@Throttle(CATALOG_READ_THROTTLE)',
  'uploadLogo',
  'deleteClub',
]) {
  requireContains(clubsControllerText, 'apps/api/src/modules/clubs/clubs.controller.ts', expected);
}
for (const expected of [
  'events/:eventId/dashboard-stats',
  'events/:eventId/clubs',
  'events/:eventId/club-requests',
]) {
  requireContains(
    eventsControllerText,
    'apps/api/src/modules/events/events.controller.ts',
    expected,
  );
}
for (const expected of ['getEventDashboardStats', 'listEventClubs', 'submitClubReviewRequest']) {
  requireContains(eventsServiceText, 'apps/api/src/modules/events/events.service.ts', expected);
}
for (const expected of [
  "deleteClub(club, 'safe')",
  "deleteClub(club, 'archive')",
  "deleteClub(club, 'cleanup')",
  'admin.clubs.safeDelete',
  'admin.clubs.archive',
  'admin.clubs.cleanupDelete',
  'common.tooManyRequests',
  'actions.retry',
]) {
  requireContains(superAdminClubsPageText, 'apps/web-admin/app/admin/clubs/page.tsx', expected);
}
for (const [label, text] of [
  ['apps/api/src/modules/admin/users.controller.ts', adminUsersControllerText],
  ['apps/api/src/modules/fighters/fighters.controller.ts', fightersControllerText],
  ['apps/api/src/modules/clubs/clubs.controller.ts', clubsControllerText],
]) {
  if (text.includes('@SkipThrottle')) {
    errors.push(`${label} must not bypass throttling for admin/catalog read endpoints.`);
  }
}
requireContains(
  clubArchivingMigrationText,
  'packages/db/migrations/0036_club_archiving.sql',
  'archived_at',
);
for (const expected of [
  'CREATE TABLE IF NOT EXISTS club_review_requests',
  "status IN ('pending', 'approved', 'linked', 'rejected')",
  'proposed_club_id',
  'linked_existing_club_id',
  'ENABLE ROW LEVEL SECURITY',
]) {
  requireContains(
    clubReviewRequestsMigrationText,
    'packages/db/migrations/0037_club_review_requests.sql',
    expected,
  );
}
for (const expected of [
  'loadVersions',
  '/api/v1/admin/system-versions',
  'admin.systemVersions.refresh',
  'admin.systemVersions.refreshing',
]) {
  requireContains(
    superAdminSystemVersionsPageText,
    'apps/web-admin/app/admin/system-versions/page.tsx',
    expected,
  );
}
for (const expected of [
  'admin.backups.browse',
  'admin.backups.totalSize',
  'admin.backups.scheduleTitle',
  'admin.backups.scheduleSave',
  '/api/v1/admin/backups/schedule',
  "method: 'PUT'",
  'formatTimestamp',
  'ConfirmDialog',
  'admin.backups.restoreDialogTitle',
  'admin.backups.deleteDialogTitle',
  'admin.backups.deleteFrom',
  'confirmed: true',
  'type="file"',
  'className="sr-only"',
]) {
  requireContains(superAdminBackupsPageText, 'apps/web-admin/app/admin/backups/page.tsx', expected);
}
for (const expected of ['Delete from {location}', 'local server', 'Scaleway S3']) {
  requireContains(i18nText, 'packages/i18n/src/index.ts', expected);
}
if (superAdminBackupsPageText.includes('confirmationByBackup')) {
  errors.push(
    'apps/web-admin/app/admin/backups/page.tsx must not use typed restore confirmation state.',
  );
}
if (superAdminBackupsPageText.includes('admin.backups.restoreConfirmation')) {
  errors.push(
    'apps/web-admin/app/admin/backups/page.tsx must not render restore confirmation phrase input.',
  );
}
for (const expected of [
  "@Delete(':backupId')",
  'deleteBackup',
  "location: Extract<BackupLocation, 'local' | 's3'>",
  "@Get('schedule')",
  "@Put('schedule')",
  'getSchedule',
  'updateSchedule',
]) {
  requireContains(
    adminBackupsControllerText,
    'apps/api/src/modules/admin/backups.controller.ts',
    expected,
  );
}
for (const expected of [
  'deleteBackup',
  "location: Extract<BackupLocation, 'local' | 's3'>",
  'getSchedule',
  'updateSchedule',
  "opsPut<BackupScheduleDto>('/schedule'",
]) {
  requireContains(
    adminBackupsServiceText,
    'apps/api/src/modules/admin/backups.service.ts',
    expected,
  );
}
for (const expected of ['dto.confirmed', 'RESTORE MYCLASH ${dto.backupId}', 'opsDelete']) {
  requireContains(
    adminBackupsServiceText,
    'apps/api/src/modules/admin/backups.service.ts',
    expected,
  );
}
for (const expected of [
  "req.method === 'DELETE'",
  'deleteBackup(url)',
  'deleteLocalBackupArtifacts',
  'deleteS3BackupArtifacts',
  'readBackupSchedule',
  'writeBackupSchedule',
  'shouldRunScheduledBackup',
  'maybeRunScheduledBackup',
  'aws',
  's3',
  'rm',
]) {
  requireContains(opsRunnerServerText, 'infra/ops-runner/server.mjs', expected);
}
for (const forbidden of ['CRON_LINE=', '0 3 * * *']) {
  if (vpsBootstrapText.includes(forbidden)) {
    errors.push(
      `infra/scripts/vps-bootstrap.sh must not install legacy fixed backup cron (${forbidden}).`,
    );
  }
}
requireContains(
  vpsBootstrapText,
  'infra/scripts/vps-bootstrap.sh',
  'Removed legacy host backup cron',
);
requireContains(
  opsRunnerBackupCoreText,
  'infra/ops-runner/backup-core.mjs',
  'expectedBackupArtifactFilenames',
);
for (const expected of ['getAuthAdminUser', 'updateAuthAdminUser']) {
  requireContains(
    supabaseServiceText,
    'apps/api/src/modules/supabase/supabase.service.ts',
    expected,
  );
}
requireContains(
  adminDashboardStatsControllerText,
  'apps/api/src/modules/admin/dashboard-stats.controller.ts',
  '@UseGuards(PlatformRoleGuard)',
);
requireContains(
  adminDashboardStatsControllerText,
  'apps/api/src/modules/admin/dashboard-stats.controller.ts',
  "@Controller('admin/dashboard-stats')",
);

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
  for (const expected of [
    'COPY --chown=nestjs:nodejs VERSION ./VERSION',
    'COPY --chown=nestjs:nodejs infra/docker-compose.prod.yml ./infra/docker-compose.prod.yml',
    'COPY --chown=nestjs:nodejs apps/web-admin/package.json ./apps/web-admin/package.json',
    'COPY --chown=nestjs:nodejs apps/web-public/package.json ./apps/web-public/package.json',
    'COPY --chown=nestjs:nodejs apps/web-scoring/package.json ./apps/web-scoring/package.json',
    'COPY --chown=nestjs:nodejs apps/web-marketing/package.json ./apps/web-marketing/package.json',
  ]) {
    requireContains(apiDockerfile.text, apiDockerfile.filePath, expected);
  }
  if (apiDockerfile.text.includes('./db-migrate.mjs')) {
    errors.push(
      'apps/api/Dockerfile must not copy the DB migration script to /app/db-migrate.mjs.',
    );
  }
}
for (const expected of [
  'SYSTEM_VERSIONS_ROOT_DIR: /app',
  'SYSTEM_VERSIONS_PATH: /app/data/system-versions.json',
]) {
  requireContains(composeText, 'infra/docker-compose.prod.yml', expected);
}
for (const expected of [
  'parseComposeImages',
  "process.env['GIT_COMMIT']",
  'infrastructureServiceKeys',
  'appContainerLabels',
]) {
  requireContains(
    adminSystemVersionsServiceText,
    'apps/api/src/modules/admin/system-versions.service.ts',
    expected,
  );
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
  '--certificatesresolvers.letsencrypt.acme.storage=/data/${ACME_STORAGE_FILE:-acme.json}',
  '--certificatesresolvers.letsencrypt.acme.caserver=${ACME_CA_SERVER:-https://acme-v02.api.letsencrypt.org/directory}',
  '--certificatesresolvers.letsencrypt.acme.tlschallenge=true',
  // The dashboard 404'd for weeks because the staging overlay's copy of this
  // command list omitted them. Pin both.
  '--api=true',
  '--api.dashboard=true',
]) {
  if (!composeText.includes(expected)) errors.push(`Missing Traefik edge setting: ${expected}`);
}
if (!deployText.includes('chmod 600 "$ACME_FILE"')) {
  errors.push('deploy.sh must enforce ACME storage permissions with chmod 600.');
}

// Compose REPLACES list-valued keys instead of merging them, so a second copy of
// traefik's `command:` in the staging overlay silently drops any prod-only flag —
// exactly how --api/--api.dashboard went missing. The overlay must select the
// staging CA via ACME_CA_SERVER/ACME_STORAGE_FILE instead.
if (/^\s+command:/mu.test(stagingCertsComposeText)) {
  errors.push(
    'infra/docker-compose.staging-certs.yml must not redefine a `command:` — Compose replaces ' +
      'command lists rather than merging them, which silently drops prod-only Traefik flags. ' +
      'Select the staging CA with ACME_CA_SERVER / ACME_STORAGE_FILE instead.',
  );
}
for (const script of [
  { name: 'deploy.sh', text: deployText },
  { name: 'redeploy.sh', text: redeployText },
]) {
  for (const expected of [
    'export ACME_STORAGE_FILE=acme-staging.json',
    'export ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory',
  ]) {
    if (!script.text.includes(expected)) {
      errors.push(`${script.name} must export ${expected} under --dev-certs.`);
    }
  }
}

// api@internal serves only /api/… and /dashboard/…, so the bare root 404s without
// this redirect.
if (!traefikMiddlewareText.includes('myclash-dashboard-root-redirect:')) {
  errors.push(
    'infra/config/traefik/middlewares.yml must define myclash-dashboard-root-redirect ' +
      '(sends traefik.${DOMAIN}/ → /dashboard/).',
  );
}
if (
  !/traefik\.http\.routers\.myclash-traefik-dashboard\.middlewares=.*myclash-dashboard-root-redirect@file/u.test(
    composeText,
  )
) {
  errors.push(
    'Router myclash-traefik-dashboard must chain myclash-dashboard-root-redirect@file, ' +
      'otherwise https://traefik.${DOMAIN}/ returns "404 page not found".',
  );
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

// ── Supabase Studio gates ───────────────────────────────────────────────────
// Studio has no authentication of its own (upstream delegates that to Kong,
// which this stack dropped) and queries Postgres as the superuser, bypassing
// RLS. The edge is the entire access control, so both gates are pinned here.
//
// The literal @docker names are the point of the assertion. TRAEFIK_PLUGINS=off
// empties the ${MW_*} prefixes so the public site keeps serving through a plugin
// outage; folding Studio's gates into one of those prefixes would make the same
// kill-switch publish an unauthenticated SQL editor. Written out in full, they
// survive it — and this check fails the moment someone "tidies" them into a
// variable.
const studioMiddlewaresMatch = composeText.match(
  /traefik\.http\.routers\.myclash-studio\.middlewares=(?<chain>.*)/u,
);
if (!studioMiddlewaresMatch?.groups?.['chain']) {
  errors.push('docker-compose.prod.yml must define the myclash-studio router middleware chain.');
} else {
  const chain = studioMiddlewaresMatch.groups['chain'];
  for (const gate of ['myclash-studio-ipallow@docker', 'myclash-studio-auth@docker']) {
    if (!chain.includes(gate)) {
      errors.push(
        `myclash-studio router must attach ${gate} literally, never through a \${MW_*} prefix ` +
          'that TRAEFIK_PLUGINS=off would empty.',
      );
    }
  }
}

for (const expected of [
  // Derived in traefik-env.sh, loopback-only when THROTTLE_IP_WHITELIST is empty.
  'traefik.http.middlewares.myclash-studio-ipallow.ipallowlist.sourcerange=${TRAEFIK_STUDIO_ALLOWLIST}',
  'traefik.http.middlewares.myclash-studio-auth.basicauth.users=${STUDIO_BASIC_AUTH}',
]) {
  if (!composeText.includes(expected)) {
    errors.push(`Missing Supabase Studio gate: ${expected}`);
  }
}

// The ban allowlist carries the RFC1918 ranges so the edge never bans the local
// network. Granting that same range a superuser SQL console is a different
// decision entirely — these two lists must not be conflated.
if (
  /myclash-studio-ipallow\.ipallowlist\.sourcerange=\$\{TRAEFIK_BAN_ALLOWLIST\}/u.test(composeText)
) {
  errors.push(
    'Studio must not reuse TRAEFIK_BAN_ALLOWLIST — it includes the private ranges by design.',
  );
}

if (!traefikEnvLibText.includes('TRAEFIK_STUDIO_ALLOWLIST')) {
  errors.push('infra/scripts/lib/traefik-env.sh must export TRAEFIK_STUDIO_ALLOWLIST.');
}

// ── Traefik edge plugins (GeoBlock + Fail2Ban) ──────────────────────────────
// Plugins load ONLY at container start, so these declarations are what make a
// fresh deploy come up with them already installed.
for (const expected of [
  '--experimental.plugins.geoblock.modulename=github.com/PascalMinder/geoblock',
  '--experimental.plugins.geoblock.version=v0.3.8',
  '--experimental.plugins.fail2ban.modulename=github.com/tomMoulard/fail2ban',
  '--experimental.plugins.fail2ban.version=v0.9.0',
  // Downloads land here; without the volume every restart re-fetches from GitHub.
  './data/traefik/plugins:/plugins-storage',
]) {
  if (!composeText.includes(expected)) {
    errors.push(`Missing Traefik plugin setting: ${expected}`);
  }
}

// AbortOnPluginFailure must stay at its default (false) so a failed plugin fetch
// never stops Traefik from serving. Availability is restored instead by the
// TRAEFIK_PLUGINS kill-switch, because a router referencing a middleware whose
// plugin didn't load fails to build and serves 404.
if (/--experimental\.abortonpluginfailure=true/iu.test(composeText)) {
  errors.push(
    'Do not set --experimental.abortonpluginfailure=true: a failed plugin fetch must not stop ' +
      'Traefik. Recovery is TRAEFIK_PLUGINS=off (see infra/scripts/lib/traefik-env.sh).',
  );
}

for (const middleware of ['myclash-geoblock-admin:', 'myclash-geoblock-public:']) {
  if (!traefikMiddlewareText.includes(middleware)) {
    errors.push(`infra/config/traefik/middlewares.yml must define ${middleware}`);
  }
  if (!devTraefikDynamicText.includes(middleware)) {
    errors.push(`infra/traefik/dynamic.dev.yml must define ${middleware} (dev/prod parity)`);
  }
}

// GeoBlock's validateConfig requires `api` to be present AND to contain {ip};
// there is no code default. Omitting it fails the middleware build with
// "no api uri given", which disables every router referencing it — the whole
// site 404s while Traefik itself looks healthy. Caught exactly this in dev.
for (const { file, text } of [
  { file: 'infra/config/traefik/middlewares.yml', text: traefikMiddlewareText },
  { file: 'infra/traefik/dynamic.dev.yml', text: devTraefikDynamicText },
]) {
  const geoblockCount = (text.match(/^\s+geoblock:$/gmu) ?? []).length;
  const apiCount = (text.match(/^\s+api:\s*'[^']*\{ip\}[^']*'/gmu) ?? []).length;
  if (apiCount < geoblockCount) {
    errors.push(
      `${file}: every geoblock instance needs an \`api:\` containing {ip} (${apiCount}/${geoblockCount} ` +
        'have one). Without it the middleware fails to build and its routers serve 404.',
    );
  }
}

// The public instance MUST fail open. GeoBlock resolves each uncached IP against
// get.geojs.io; failing closed there turns a third-party API outage into a full
// public-site outage. The admin instance deliberately fails closed.
const publicGeoblockBlock = traefikMiddlewareText.slice(
  traefikMiddlewareText.indexOf('myclash-geoblock-public:'),
);
if (!/allowUnknownCountries:\s*true/u.test(publicGeoblockBlock)) {
  errors.push(
    'myclash-geoblock-public must set allowUnknownCountries: true — failing closed on the public ' +
      'site converts a get.geojs.io outage into a site outage.',
  );
}

// Fail2Ban lives in labels, not the file provider: its allowlist carries the
// operator IP, and only labels are interpolated by Compose. Keeping it out of
// middlewares.yml is what keeps that address out of this public repo.
for (const middleware of ['myclash-fail2ban-auth', 'myclash-fail2ban-staff']) {
  const labelPattern = new RegExp(
    `traefik\\.http\\.middlewares\\.${escapeRegExp(middleware)}\\.plugin\\.fail2ban\\.allowlist\\.ip=`,
    'u',
  );
  if (!labelPattern.test(composeText)) {
    errors.push(`Missing Fail2Ban middleware label for ${middleware}.`);
  }
  if (!labelPattern.test(devComposeText)) {
    errors.push(`infra/docker-compose.dev.yml must define ${middleware} (dev/prod parity).`);
  }
}
if (traefikMiddlewareText.includes('fail2ban')) {
  errors.push(
    'Fail2Ban must not be defined in infra/config/traefik/middlewares.yml — the file provider is ' +
      'never interpolated, so the allowlist IP would have to be committed to this public repo.',
  );
}
// EVERY allowlist label must interpolate — checking that one of them does would
// let a hardcoded IP slip in beside a correct one.
const prodAllowlistValues = [...composeText.matchAll(/allowlist\.ip=([^\n]*)/gu)].map((match) =>
  match[1].trim(),
);
if (prodAllowlistValues.length === 0) {
  errors.push('No Fail2Ban allowlist label found in infra/docker-compose.prod.yml.');
}
for (const value of prodAllowlistValues) {
  if (value !== '${TRAEFIK_BAN_ALLOWLIST}') {
    errors.push(
      `Fail2Ban allowlist must interpolate \${TRAEFIK_BAN_ALLOWLIST} (derived from ` +
        `THROTTLE_IP_WHITELIST), got "${value}". A literal IP here would be committed to this ` +
        "public repo and would drift from the app throttler's whitelist.",
    );
  }
}

// Compose reads MW_*/TRAEFIK_BAN_ALLOWLIST from the invoking shell, not
// --env-file. Miss one entrypoint and the stack comes up with an empty allowlist
// or detached middlewares depending on which script was used.
// Enumerated dynamically rather than hard-coded: the first version of this check
// listed deploy/redeploy/start only, and restore.sh + rollback.sh silently
// started the stack with the plugin middlewares DETACHED (and every other
// compose call printed "variable is not set" warnings). Any script that drives
// the prod compose file needs the exports.
const scriptsDir = path.join(rootDir, 'infra', 'scripts');
const shellScripts = (await readdir(scriptsDir)).filter((f) => f.endsWith('.sh'));
for (const name of shellScripts) {
  const text = await readFile(path.join(scriptsDir, name), 'utf8');
  if (!text.includes('docker-compose.prod.yml')) continue; // not a stack driver
  if (!text.includes('lib/traefik-env.sh')) {
    errors.push(
      `infra/scripts/${name} runs the prod compose file but does not source lib/traefik-env.sh — ` +
        'it exports TRAEFIK_BAN_ALLOWLIST and the MW_* middleware prefixes that Compose interpolates ' +
        'from the invoking shell. Without it the stack comes up with GeoBlock/Fail2Ban detached.',
    );
  }
}
if (!traefikEnvLibText.includes('THROTTLE_IP_WHITELIST')) {
  errors.push(
    'infra/scripts/lib/traefik-env.sh must derive TRAEFIK_BAN_ALLOWLIST from THROTTLE_IP_WHITELIST.',
  );
}
if (!traefikEnvLibText.includes('mc_warn_if_plugins_failed')) {
  errors.push(
    'infra/scripts/lib/traefik-env.sh must define mc_warn_if_plugins_failed — Traefik boots on ' +
      'plugin failure, so nothing else tells the operator the edge lost its security middlewares.',
  );
}
// The log grep only sees a failed DOWNLOAD. A plugin that downloads and then
// rejects its config leaves its routers serving 404 with nothing in the log, so
// the probe is the only check that covers that failure — and it is worthless if
// an entrypoint stops calling it.
if (!traefikEnvLibText.includes('mc_verify_edge_plugins')) {
  errors.push(
    'infra/scripts/lib/traefik-env.sh must define mc_verify_edge_plugins — the log grep cannot ' +
      'see a plugin that downloaded and then failed to configure.',
  );
}
for (const name of ['deploy.sh', 'redeploy.sh', 'start.sh']) {
  const text = await readFile(path.join(scriptsDir, name), 'utf8');
  if (!text.includes('mc_verify_edge_plugins')) {
    errors.push(
      `infra/scripts/${name} must call mc_verify_edge_plugins after bringing the stack up — ` +
        'otherwise a misconfigured plugin 404s the site with every other check green.',
    );
  }
}
const rootPackageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
if (rootPackageJson.scripts?.['infra:plugins'] !== 'node scripts/check-edge-plugins.mjs') {
  errors.push('package.json must expose pnpm infra:plugins → node scripts/check-edge-plugins.mjs.');
}

// Dev must declare the same plugins at the same versions, or the config is first
// exercised in front of the live site.
for (const expected of [
  'moduleName: github.com/PascalMinder/geoblock',
  'version: v0.3.8',
  'moduleName: github.com/tomMoulard/fail2ban',
  'version: v0.9.0',
]) {
  if (!devTraefikStaticText.includes(expected)) {
    errors.push(`infra/traefik/traefik.dev.yml must declare plugin setting: ${expected}`);
  }
}

// Every router must carry the geoblock variant its host implies. The @file /
// @docker suffix is asserted explicitly: a wrong provider suffix resolves to no
// middleware at all, which fails open and silently.
const geoblockRouters = {
  'myclash-admin': 'admin',
  'myclash-admin-api': 'admin',
  'myclash-admin-storage': 'admin',
  'myclash-admin-scoring': 'admin',
  'myclash-traefik-dashboard': 'admin',
  'myclash-public': 'public',
  'myclash-marketing': 'public',
  'myclash-scoring': 'public',
  'myclash-scoring-prefixed': 'public',
  'myclash-scoring-api': 'public',
  'myclash-api': 'public',
  'myclash-public-api': 'public',
  'myclash-rest': 'public',
  'myclash-auth': 'public',
  'myclash-realtime': 'public',
  'myclash-realtime-api': 'public',
  'myclash-storage': 'public',
};
for (const [router, variant] of Object.entries(geoblockRouters)) {
  const pattern = new RegExp(
    `traefik\\.http\\.routers\\.${escapeRegExp(router)}\\.middlewares=\\$\\{MW_GEO_${variant.toUpperCase()}\\}`,
    'u',
  );
  if (!pattern.test(composeText)) {
    errors.push(
      `Router ${router} must chain \${MW_GEO_${variant.toUpperCase()}} (geoblock ${variant}).`,
    );
  }
}

// Fail2Ban guards only the surfaces the app itself does not rate-limit.
// myclash-admin-api is excluded ON PURPOSE: sliding sessions make expired
// cookies emit 401 bursts that are indistinguishable from an attack.
const fail2banRouters = {
  'myclash-auth': 'MW_F2B_AUTH',
  'myclash-traefik-dashboard': 'MW_F2B_AUTH',
  'myclash-scoring-api': 'MW_F2B_STAFF',
};
for (const [router, prefix] of Object.entries(fail2banRouters)) {
  const pattern = new RegExp(
    `traefik\\.http\\.routers\\.${escapeRegExp(router)}\\.middlewares=[^\\n]*\\$\\{${prefix}\\}`,
    'u',
  );
  if (!pattern.test(composeText)) {
    errors.push(`Router ${router} must chain \${${prefix}} (fail2ban).`);
  }
}
if (/routers\.myclash-admin-api\.middlewares=[^\n]*fail2ban/u.test(composeText)) {
  errors.push(
    'myclash-admin-api must NOT chain fail2ban: expired sliding sessions emit parallel 401 bursts ' +
      'that would ban legitimate admins. The admin country allow-list is the control there.',
  );
}

// Kong is gone from dev: prod routes the Supabase sub-paths through Traefik, so
// dev does too. Reintroducing it would restore the divergence that hid the
// realtime /socket path change until it reached production.
if (/^\s{2}kong:/mu.test(devComposeText)) {
  errors.push(
    'infra/docker-compose.dev.yml must not reintroduce the kong service — prod routes Supabase ' +
      'sub-paths through Traefik, and dev must exercise the same edge path.',
  );
}

// Dev routers carry the middlewares literally (no MW_* kill-switch): dev is
// exactly where a broken plugin config should surface, so it is never detached.
const devGeoblockRouters = {
  'dev-admin': 'admin',
  'dev-admin-api': 'admin',
  'dev-public': 'public',
  'dev-scoring': 'public',
  'dev-api': 'public',
  'dev-auth': 'public',
  'dev-rest': 'public',
  'dev-realtime': 'public',
  'dev-realtime-api': 'public',
  'dev-storage': 'public',
};
for (const [router, variant] of Object.entries(devGeoblockRouters)) {
  const pattern = new RegExp(
    `traefik\\.http\\.routers\\.${escapeRegExp(router)}\\.middlewares=myclash-geoblock-${variant}@file`,
    'u',
  );
  if (!pattern.test(devComposeText)) {
    errors.push(
      `Dev router ${router} must chain myclash-geoblock-${variant}@file (dev/prod parity).`,
    );
  }
}
for (const [router, middleware] of Object.entries({
  'dev-auth': 'myclash-fail2ban-auth@docker',
  'dev-api': 'myclash-fail2ban-staff@docker',
})) {
  const pattern = new RegExp(
    `traefik\\.http\\.routers\\.${escapeRegExp(router)}\\.middlewares=[^\\n]*${escapeRegExp(middleware)}`,
    'u',
  );
  if (!pattern.test(devComposeText)) {
    errors.push(`Dev router ${router} must chain ${middleware} (dev/prod parity).`);
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
