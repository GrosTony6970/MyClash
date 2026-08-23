/**
 * `pnpm infra:review` — the offline gate over things that are true across FILES
 * rather than inside one.
 *
 * ── What it actually reviews, which is not only infrastructure ──────────────
 * The name is half a lie and has been for months, so it is written down here
 * rather than discovered on the twentieth read. Of the 424 assertions the
 * verdict line counts, 163 target infrastructure and 261 target application
 * source — 131 in apps/web-admin, 100 in apps/api, 12 in apps/web-public, 16 in
 * packages/, 2 in scripts/. 77 paths are pinned as constants at the top; the
 * run reads 106 files in total, the rest reached by enumerating a directory.
 *
 * That count is requireContains only. Roughly 90 further checks are written
 * inline as `if (text.includes(…)) errors.push(…)`, mostly the negative ones —
 * so the verdict line understates, which is the safe direction for a number
 * nothing recomputes. Four distinct concerns share the file:
 *
 *   1. INFRA TOPOLOGY. Compose services, healthchecks, deploy/restore/rollback
 *      shell scripts, the Traefik edge, dev/prod parity. The strongest work
 *      here, because most of it is DERIVED rather than pinned: healthcheckOwner
 *      resolves a probe from compose or from the Dockerfile the service builds;
 *      the deploy health-wait requirement is computed from compose itself; the
 *      traefik-env sweep enumerates infra/scripts/*.sh instead of listing them.
 *      Derived checks survive refactors, which is why these have.
 *
 *   2. API SOURCE TEXT. Decorators, forbidden calls, method and route names.
 *      Some of it is the only guard there is — the four bans on
 *      supabase.anon.auth.getUser are a deliberate exception list, since 21
 *      other API files use that call legitimately.
 *
 *   3. WEB APP SOURCE TEXT. The largest single group and the weakest as a
 *      group, but it holds at least one invariant nothing else holds: the
 *      sticky-not-fixed chrome rule below, whose regression painted the root
 *      layout's banners over.
 *
 *   4. ENGLISH COPY, asserted against the EN dictionary.
 *
 * ── Where the rot is ────────────────────────────────────────────────────────
 * Groups 2-4 pin file LOCATIONS and literal strings, so they go red on renames
 * and refactors that broke nothing. Four of this file's commits are repairs of
 * exactly that. Two rules keep that cost bounded:
 *
 *   - Assert the RELATIONSHIP, not the snapshot, wherever the relationship can
 *     be read. The realtime tenant check compares the tenant to the router's
 *     Host label instead of pinning a name; the GoTrue password policy is
 *     compared to PASSWORD_SPECIAL_CHARS read out of packages/types. An earlier
 *     version of the chrome rule pinned the old class string and sat red for as
 *     long as the fix was in place.
 *   - Before adding an assertion here, check whether a typed test can hold it
 *     instead. platform-role-coverage.test.ts walks real Nest metadata and is
 *     strictly stronger than any `@UseGuards(...)` substring could be; a text
 *     assertion is the tool of last resort, for facts no type system sees.
 *
 * Errors accumulate and are reported together — one bad line must not hide the
 * other twenty findings, which is the same reason CI runs each gate as its own
 * step.
 */
import path from 'node:path';

import { runnerStageWorkspaces } from './lib/dockerfile-workspaces.mjs';
import { createPinnedReader, isMissingPinnedFile } from './lib/pinned-file.mjs';

const rootDir = path.resolve(import.meta.dirname, '..');

// Every file below is pinned BY PATH. Read them through the reader, never
// through fs directly: a renamed file must become a finding that names it, not
// an unhandled ENOENT that takes the other 400-odd assertions down with it.
const pinned = createPinnedReader(rootDir);
const composePath = path.join(rootDir, 'infra', 'docker-compose.prod.yml');
const devComposePath = path.join(rootDir, 'infra', 'docker-compose.dev.yml');
const deployPath = path.join(rootDir, 'infra', 'scripts', 'deploy.sh');
const redeployPath = path.join(rootDir, 'infra', 'scripts', 'redeploy.sh');
const statusPath = path.join(rootDir, 'infra', 'scripts', 'status.sh');
const restorePath = path.join(rootDir, 'infra', 'scripts', 'restore.sh');
const rollbackPath = path.join(rootDir, 'infra', 'scripts', 'rollback.sh');
const startPath = path.join(rootDir, 'infra', 'scripts', 'start.sh');
const traefikEnvLibPath = path.join(rootDir, 'infra', 'scripts', 'lib', 'traefik-env.sh');
const systemVersionsLibPath = path.join(rootDir, 'infra', 'scripts', 'lib', 'system-versions.sh');
const devTraefikStaticPath = path.join(rootDir, 'infra', 'traefik', 'traefik.dev.yml');
const devTraefikDynamicPath = path.join(rootDir, 'infra', 'traefik', 'dynamic.dev.yml');
const vpsBootstrapPath = path.join(rootDir, 'infra', 'scripts', 'vps-bootstrap.sh');
const publicRootPagePath = path.join(rootDir, 'apps', 'web-public', 'app', 'page.tsx');
const publicLoginPagePath = path.join(rootDir, 'apps', 'web-public', 'app', 'login', 'page.tsx');
const publicLoginRequestsPath = path.join(
  rootDir,
  'apps',
  'web-public',
  'app',
  'login',
  'auth-requests.ts',
);
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
const adminLandingDecisionPath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'src',
  'components',
  'admin-landing-decision.ts',
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
// The identity read both shells open with. It used to be a hand-rolled fetch
// copied into each of them, which is why the `/api/v1/me` assertion below was
// pinned to the shells; it is one hook now, so the URL is asserted where it
// actually lives and the shells are asserted to still call it.
const identityGatePath = path.join(
  rootDir,
  'apps',
  'web-admin',
  'src',
  'hooks',
  'useIdentityGate.ts',
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
// The EN dictionary, which is one module per namespace since the per-surface
// split. These assertions only ever meant "this copy exists somewhere in the
// dictionary", so they read the whole tree rather than pinning one file — which
// is what made them break when the data moved out of index.ts.
const i18nMessagesDir = path.join(rootDir, 'packages', 'i18n', 'src', 'messages', 'en');
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
  'apps/web-staff/Dockerfile',
  'apps/web-marketing/Dockerfile',
  'infra/ops-runner/Dockerfile',
];

const composeText = await pinned.readPinnedFile(composePath);
const devComposeText = await pinned.readPinnedFile(devComposePath);
const passwordSpecialChars = await readPasswordSpecialChars();

/**
 * The one owner of "what counts as a special character", read out of the
 * TypeScript source so this gate compares the compose value to the real
 * constant rather than to a copy of it that can rot independently.
 *
 * Returns null when the source is absent — the reader has already recorded that
 * path, and the policy comparison skips rather than reporting a mismatch
 * against nothing. A malformed export still throws: that is a claim about a
 * file that IS there, and it must not degrade into a silent skip.
 */
async function readPasswordSpecialChars() {
  const source = await pinned.readPinnedFile(
    path.join(rootDir, 'packages', 'types', 'src', 'password.ts'),
  );
  if (isMissingPinnedFile(source)) return null;
  const match = /export const PASSWORD_SPECIAL_CHARS = '(.*)';/u.exec(source);
  if (!match) {
    throw new Error(
      'packages/types/src/password.ts must export PASSWORD_SPECIAL_CHARS as a single-quoted literal — ' +
        'the GoTrue policy check reads it from there.',
    );
  }
  // Un-escape the TS string literal: only \' and \\ can appear in this set.
  return match[1].replaceAll("\\'", "'").replaceAll('\\\\', '\\');
}
const deployText = await pinned.readPinnedFile(deployPath);
const redeployText = await pinned.readPinnedFile(redeployPath);
const statusText = await pinned.readPinnedFile(statusPath);
const restoreText = await pinned.readPinnedFile(restorePath);
const rollbackText = await pinned.readPinnedFile(rollbackPath);
const vpsBootstrapText = await pinned.readPinnedFile(vpsBootstrapPath);
const publicRootPageText = await pinned.readPinnedFile(publicRootPagePath);
const publicLoginPageText = await pinned.readPinnedFile(publicLoginPagePath);
const publicLoginRequestsText = await pinned.readPinnedFile(publicLoginRequestsPath);
const publicOAuthCallbackText = await pinned.readPinnedFile(publicOAuthCallbackPath);
const publicPersonalLayoutText = await pinned.readPinnedFile(publicPersonalLayoutPath);
const publicPersonalPageText = await pinned.readPinnedFile(publicPersonalPagePath);
const publicPersonalDashboardText = await pinned.readPinnedFile(publicPersonalDashboardPath);
const publicPersonalShellText = await pinned.readPinnedFile(publicPersonalShellPath);
const publicEventRootPageText = await pinned.readPinnedFile(publicEventRootPagePath);
const adminRootPageText = await pinned.readPinnedFile(adminRootPagePath);
const adminDashboardPageText = await pinned.readPinnedFile(adminDashboardPagePath);
const adminLandingDecisionText = await pinned.readPinnedFile(adminLandingDecisionPath);
const bootstrapSuperAdminScriptText = await pinned.readPinnedFile(bootstrapSuperAdminScriptPath);
const seedMinScriptText = await pinned.readPinnedFile(seedMinScriptPath);
const superAdminPageText = await pinned.readPinnedFile(superAdminPagePath);
const superAdminOrganizationsPageText = await pinned.readPinnedFile(
  superAdminOrganizationsPagePath,
);
const superAdminOrganizationDetailPageText = await pinned.readPinnedFile(
  superAdminOrganizationDetailPagePath,
);
const superAdminUsersPageText = await pinned.readPinnedFile(superAdminUsersPagePath);
const accountsPanelText = await pinned.readPinnedFile(accountsPanelPath);
const accountsTableText = await pinned.readPinnedFile(accountsTablePath);
const createPlatformAccountFormText = await pinned.readPinnedFile(createPlatformAccountFormPath);
const useAdminUsersText = await pinned.readPinnedFile(useAdminUsersPath);
const superAdminFightersPageText = await pinned.readPinnedFile(superAdminFightersPagePath);
const superAdminClubsPageText = await pinned.readPinnedFile(superAdminClubsPagePath);
const superAdminBackupsPageText = await pinned.readPinnedFile(superAdminBackupsPagePath);
const superAdminSystemVersionsPageText = await pinned.readPinnedFile(
  superAdminSystemVersionsPagePath,
);
const adminSystemVersionsServiceText = await pinned.readPinnedFile(adminSystemVersionsServicePath);
const superAdminLayoutText = await pinned.readPinnedFile(superAdminLayoutPath);
const superAdminShellText = await pinned.readPinnedFile(superAdminShellPath);
const organizerLayoutText = await pinned.readPinnedFile(organizerLayoutPath);
const organizerShellText = await pinned.readPinnedFile(organizerShellPath);
const identityGateText = await pinned.readPinnedFile(identityGatePath);
const organizerDashboardPageText = await pinned.readPinnedFile(organizerDashboardPagePath);
const organizerEventsPageText = await pinned.readPinnedFile(organizerEventsPagePath);
const organizerEventPageText = await pinned.readPinnedFile(organizerEventPagePath);
const organizerEventClubsPageText = await pinned.readPinnedFile(organizerEventClubsPagePath);
const organizerNewTournamentPageText = await pinned.readPinnedFile(organizerNewTournamentPagePath);
const organizerAiSettingsPageText = await pinned.readPinnedFile(organizerAiSettingsPagePath);
const appModuleText = await pinned.readPinnedFile(appModulePath);
const authControllerText = await pinned.readPinnedFile(authControllerPath);
const signupControllerText = await pinned.readPinnedFile(signupControllerPath);
const authServiceText = await pinned.readPinnedFile(authServicePath);
const supabaseServiceText = await pinned.readPinnedFile(supabaseServicePath);
const compensationControllerText = await pinned.readPinnedFile(compensationControllerPath);
const leaguesControllerText = await pinned.readPinnedFile(leaguesControllerPath);
const fightersControllerText = await pinned.readPinnedFile(fightersControllerPath);
const clubsControllerText = await pinned.readPinnedFile(clubsControllerPath);
const eventsControllerText = await pinned.readPinnedFile(eventsControllerPath);
const eventsServiceText = await pinned.readPinnedFile(eventsServicePath);
const adminBackupsControllerText = await pinned.readPinnedFile(adminBackupsControllerPath);
const adminBackupsServiceText = await pinned.readPinnedFile(adminBackupsServicePath);
const opsRunnerServerText = await pinned.readPinnedFile(opsRunnerServerPath);
const opsRunnerBackupCoreText = await pinned.readPinnedFile(opsRunnerBackupCorePath);
const platformRoleGuardText = await pinned.readPinnedFile(platformRoleGuardPath);
const adminDashboardStatsControllerText = await pinned.readPinnedFile(
  adminDashboardStatsControllerPath,
);
const adminOrganizationsControllerText = await pinned.readPinnedFile(
  adminOrganizationsControllerPath,
);
const adminOrganizationsServiceText = await pinned.readPinnedFile(adminOrganizationsServicePath);
const adminUsersControllerText = await pinned.readPinnedFile(adminUsersControllerPath);
const adminUsersServiceText = await pinned.readPinnedFile(adminUsersServicePath);
const i18nText = (
  await Promise.all(
    (await pinned.readPinnedDir(i18nMessagesDir))
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => pinned.readPinnedFile(path.join(i18nMessagesDir, entry))),
  )
).join('\n');
const traefikMiddlewareText = await pinned.readPinnedFile(traefikMiddlewarePath);
const startText = await pinned.readPinnedFile(startPath);
const systemVersionsLibText = await pinned.readPinnedFile(systemVersionsLibPath);
const traefikEnvLibText = await pinned.readPinnedFile(traefikEnvLibPath);
const devTraefikStaticText = await pinned.readPinnedFile(devTraefikStaticPath);
const devTraefikDynamicText = await pinned.readPinnedFile(devTraefikDynamicPath);
const stagingCertsComposeText = await pinned.readPinnedFile(stagingCertsComposePath);
const realtimeInitText = await pinned.readPinnedFile(realtimeInitPath);
const realtimeMigrationText = await pinned.readPinnedFile(realtimeMigrationPath);
const clubArchivingMigrationText = await pinned.readPinnedFile(clubArchivingMigrationPath);
const clubReviewRequestsMigrationText = await pinned.readPinnedFile(
  clubReviewRequestsMigrationPath,
);
// Absent Dockerfiles are dropped rather than carried as sentinels: every
// consumer below is already written as `if (dockerfile && …)` / `image?.text`,
// so an absent entry falls out of those guards on its own. The reader has
// already recorded the path, and one "pinned file is missing" beats a dozen
// derived complaints about a file that is not there.
const dockerfiles = (
  await Promise.all(
    dockerfilePaths.map(async (filePath) => ({
      filePath,
      text: await pinned.readPinnedFile(path.join(rootDir, filePath)),
    })),
  )
).filter((entry) => !isMissingPinnedFile(entry.text));

const errors = [];
const warnings = [];
// Counted so the verdict can state its own scope. The line used to read
// "passed for 15 services", which describes the compose block and none of the
// 400-odd assertions over 77 files that follow it — a green run understated
// what it had covered by more than an order of magnitude.
let assertionsRun = 0;

// Reported first, because every other finding a missing file produces is a
// consequence of it. `pinned.missing` also grows from the two directory reads
// and the package.json read further down, so it is re-drained before the
// verdict rather than only here.
for (const missingPath of pinned.missing) {
  errors.push(
    `Pinned file is missing: ${missingPath} — this gate asserts facts about that path. ` +
      'If it moved, re-point the constant at the top of this file; if it was deleted, delete the ' +
      'assertions that named it and say in the commit what stopped being true.',
  );
}
const reportedMissing = new Set(pinned.missing);

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
  'web-staff',
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

  // A healthcheck is equally real whether it is declared here or baked into the
  // image this service builds — `worker` has only ever had the second kind, and
  // used to need a hardcoded exception here to say so. Resolve it by reading, so
  // api/web-staff/web-admin can drop their byte-identical copies of the probe
  // their own Dockerfile already carries. supabase-rest must have NEITHER; that
  // is asserted separately below.
  if (serviceName !== 'supabase-rest' && !healthcheckOwner(service)) {
    errors.push(
      `${serviceName} has no healthcheck — declare one in compose, or add a HEALTHCHECK to ` +
        'the Dockerfile it builds.',
    );
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

// ── Web tier start ordering ────────────────────────────────────────────────
// Every web app reaches the API on first paint, and web-public's healthcheck IS
// an SSR fetch of /api/v1/events. Started in parallel with the db → api chain,
// that probe cannot do anything but fail for the first minute of a cold start —
// which is exactly what happened: two `[health/api-reachable] … ECONNREFUSED`
// lines sat at the tail of status.sh, unexplained, while the stack was healthy.
//
// Dev has gated all three on the API since the beginning; prod is what drifted,
// and nothing said so. Assert it on BOTH files so the pair cannot separate
// again. web-marketing is out on purpose: static Caddy, never calls the API.
for (const [label, serviceMap] of [
  ['prod', services],
  ['dev', devServices],
]) {
  for (const serviceName of ['web-public', 'web-staff', 'web-admin']) {
    requireContains(
      serviceMap.get(serviceName) ?? '',
      `${label} ${serviceName}`,
      'api: { condition: service_healthy }',
    );
  }
}

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
// The scoring same-origin route, both stacks. The pad fetches RELATIVE paths by
// design (apps/web-staff/src/lib/api-url.ts) so one image can serve
// staff.${DOMAIN} and admin.${DOMAIN}/staff/*; without these routers those
// fetches fall through to the Next container and 404. Dev lacked its half
// entirely, so the pad could sign in there (the host-less staff-auth router
// matched) and then fail on everything else.
requireContains(
  services.get('api') ?? '',
  'prod api scoring same-origin route',
  'traefik.http.routers.myclash-staff-api.rule=Host(`staff.${DOMAIN}`) && PathPrefix(`/api/v1`)',
);
requireContains(
  devServices.get('api') ?? '',
  'dev api scoring same-origin route',
  'traefik.http.routers.dev-staff-api.rule=Host(`staff.myclash.localhost`) && PathPrefix(`/api/v1`)',
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

// GoTrue is reachable directly at app.${DOMAIN}/auth/v1/*, so it — not our Zod
// — is the boundary for account passwords. Its default is 6 characters with no
// rules, and its required-characters list must match the set the browser
// checklist ticks against, or a password passes validation and is then refused.
assertGoTruePasswordPolicy(composeText, 'infra/docker-compose.prod.yml');
assertGoTruePasswordPolicy(devComposeText, 'infra/docker-compose.dev.yml');

function assertGoTruePasswordPolicy(text, label) {
  requireContains(text, label, 'GOTRUE_PASSWORD_MIN_LENGTH: 12');

  const match = /GOTRUE_PASSWORD_REQUIRED_CHARACTERS: '([^\n]*)'/u.exec(text);
  if (!match) {
    errors.push(`${label} must set GOTRUE_PASSWORD_REQUIRED_CHARACTERS.`);
    return;
  }

  // Compose collapses '$$' to a literal '$' before GoTrue sees the value, and
  // a single-quoted YAML scalar doubles an inner quote.
  const groups = match[1].replaceAll('$$', '$').replaceAll("''", "'").split(':');
  if (groups.length !== 4) {
    errors.push(
      `${label} GOTRUE_PASSWORD_REQUIRED_CHARACTERS must have 4 ':'-delimited groups, found ${groups.length}. ` +
        "A ':' inside a group splits it — that is why PASSWORD_SPECIAL_CHARS excludes ':'.",
    );
    return;
  }
  if (passwordSpecialChars !== null && groups[3] !== passwordSpecialChars) {
    errors.push(
      `${label} GOTRUE_PASSWORD_REQUIRED_CHARACTERS punctuation group does not match ` +
        `PASSWORD_SPECIAL_CHARS in packages/types/src/password.ts.\n` +
        `  compose: ${JSON.stringify(groups[3])}\n` +
        `  types:   ${JSON.stringify(passwordSpecialChars)}`,
    );
  }
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
  'web-staff',
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
  'supabase-meta',
  'supabase-studio',
]) {
  if (!statusText.includes(serviceName)) {
    errors.push(`status.sh Container health must include ${serviceName}.`);
  }
}

// ── Deploy health-wait coverage ─────────────────────────────────────────────
// supabase-studio sat unhealthy for two days and not one deploy said so: the
// wait covered six services out of sixteen, and anything outside that list can
// stay red forever while "Deploy complete" prints. Derive the requirement from
// compose rather than keeping yet another hand-written list — every service that
// HAS a healthcheck, declared in compose or inherited from the image it builds,
// must be waited on in one tier or the other.
//
// Two tiers on purpose. The wait runs AFTER `up -d` has already replaced every
// container, so aborting buys nothing for a sick operator console and would skip
// the super-admin bootstrap and the deploy metadata write. Critical = the public
// surface is down. Advisory = degraded, reported, survived.
const criticalWait = parseBashArray(deployText, 'CRITICAL_SERVICES');
const advisoryWait = parseBashArray(deployText, 'ADVISORY_SERVICES');
if (!criticalWait || !advisoryWait) {
  errors.push(
    'deploy.sh must declare CRITICAL_SERVICES and ADVISORY_SERVICES for the health wait.',
  );
} else {
  const waited = new Map();
  for (const [tier, list] of [
    ['critical', criticalWait],
    ['advisory', advisoryWait],
  ]) {
    for (const serviceName of list) {
      if (waited.has(serviceName)) {
        errors.push(`deploy.sh lists ${serviceName} in both health-wait tiers.`);
      }
      if (!services.has(serviceName)) {
        errors.push(
          `deploy.sh health wait names ${serviceName}, which is not a prod compose service.`,
        );
      }
      waited.set(serviceName, tier);
    }
  }
  for (const [serviceName, serviceText] of services) {
    if (!healthcheckOwner(serviceText)) continue;
    if (!waited.has(serviceName)) {
      errors.push(
        `${serviceName} has a healthcheck but deploy.sh never waits on it — add it to ` +
          'CRITICAL_SERVICES (the public surface is down without it) or ADVISORY_SERVICES ' +
          '(degraded, reported at the end).',
      );
    }
  }
}

// DROP DATABASE fails while ANY session is connected, so restore.sh and
// rollback.sh stop every service holding a pool before recreating the database.
// A new Postgres-connected service that misses these lists does not fail
// loudly — it makes the drop flaky, which is far worse to debug than a red gate.
//
// Matched against the `stop` COMMAND, not the file: every one of these service
// names also appears in the surrounding comments, so a whole-file includes()
// would be satisfied by prose and could never fail.
for (const [name, text] of [
  ['restore.sh', restoreText],
  ['rollback.sh', rollbackText],
]) {
  // `"${COMPOSE[@]}" stop \` plus its backslash-continued argument lines.
  const stopCommand = /"\$\{COMPOSE\[@\]\}"\s+stop\s+((?:[^\n]*\\\n)*[^\n]*)/u.exec(text)?.[1];
  if (!stopCommand) {
    errors.push(`${name} must stop the database-connected services before dropping the database.`);
    continue;
  }
  for (const serviceName of [
    'supabase-auth',
    'supabase-rest',
    'supabase-realtime',
    'supabase-storage',
    'supabase-meta',
  ]) {
    if (!new RegExp(`(?:^|\\s)${escapeRegExp(serviceName)}(?:\\s|\\\\|$)`, 'u').test(stopCommand)) {
      errors.push(`${name} must stop ${serviceName} before dropping the database.`);
    }
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
  if (!systemVersionsLibText.includes(expected)) {
    errors.push(
      `infra/scripts/lib/system-versions.sh manifest generation must include ${expected}.`,
    );
  }
}
// The manifest has ONE writer, and every entrypoint that changes what is running
// must go through it. It used to be written only by deploy.sh, so a redeploy left
// the admin board describing the previous deploy and a rollback left it naming
// the commit that had just been rolled back — stale in a way nothing surfaced.
for (const [label, text] of [
  ['infra/scripts/deploy.sh', deployText],
  ['infra/scripts/redeploy.sh', redeployText],
  ['infra/scripts/rollback.sh', rollbackText],
  ['infra/scripts/start.sh', startText],
]) {
  requireContains(text, label, 'source "$SCRIPT_DIR/lib/system-versions.sh"');
}
for (const [label, text] of [
  ['infra/scripts/deploy.sh', deployText],
  ['infra/scripts/redeploy.sh', redeployText],
  ['infra/scripts/rollback.sh', rollbackText],
]) {
  requireContains(text, label, 'mc_write_system_versions_manifest');
}
requireContains(startText, 'infra/scripts/start.sh', 'mc_ensure_system_versions_manifest');
// Rolled-back images used to bake GIT_COMMIT=unknown: deploy.sh and redeploy.sh
// both export it for Compose to interpolate, rollback.sh did not.
requireContains(rollbackText, 'infra/scripts/rollback.sh', 'export GIT_COMMIT="$PREV_COMMIT"');
for (const expected of ['stat.isFile()', 'Source: ${source}', 'Manifest path type: ${type}']) {
  if (!statusText.includes(expected)) {
    errors.push(`status.sh API version diagnostics must tolerate bad manifests with ${expected}.`);
  }
}
for (const [label, text] of [
  ['apps/web-public/app/page.tsx', publicRootPageText],
  ['apps/web-public/app/e/[eventSlug]/page.tsx', publicEventRootPageText],
  ['apps/web-admin/app/page.tsx', adminRootPageText],
  ['packages/i18n/src/messages/en/**', i18nText],
]) {
  if (/\bT-003\b|Placeholder -|scaffold|port 300[13]/u.test(text)) {
    errors.push(`${label} must not expose the old T-003 scaffold root-page copy.`);
  }
}
if (publicRootPageText.includes('publicApp.home.placeholder')) {
  errors.push('apps/web-public/app/page.tsx must not render publicApp.home.placeholder.');
}
// The magic-link `type` and the Google hand-off moved to the page's network
// module when the page was split; both facts are unchanged, so the assertions
// follow them rather than being dropped. The page keeps an assertion of its
// own so the two halves cannot drift apart unnoticed — a page that stops
// importing the module would otherwise leave these passing against dead code.
requireContains(
  publicLoginRequestsText,
  'apps/web-public/app/login/auth-requests.ts',
  "type: 'public_login'",
);
requireContains(
  publicLoginRequestsText,
  'apps/web-public/app/login/auth-requests.ts',
  'signInWithOAuth',
);
requireContains(
  publicLoginPageText,
  'apps/web-public/app/login/page.tsx',
  "from './auth-requests'",
);
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
// Server-only secrets in frontend source are owned by
// check-client-secret-boundaries.mjs (`pnpm security:client-secrets`), which
// walks all three web app trees instead of the nine files this gate had named.
// Do not re-add a per-file check here: a leak in the tenth file was never the
// less dangerous one, and web-staff — the app this gate never looked at — is
// where the pad's staff tokens live.
if (adminRootPageText.includes('admin.home.placeholder')) {
  errors.push('apps/web-admin/app/page.tsx must not render admin.home.placeholder.');
}
requireContains(
  publicEventRootPageText,
  'apps/web-public/app/e/[eventSlug]/page.tsx',
  'redirect(`/e/${eventSlug}/home`)',
);
// The routing is a discriminated-union resolver rather than inline
// window.location writes: super-admins with no org → /admin, org members →
// their org, dual-role (super-admin + org) → the workspace chooser, and the
// terminal no-workspace state. Assert the resolver's shape.
//
// It moved out of the page and into `admin-landing-decision.ts` on 2026-08-20,
// so that the branch ORDER — which is the subtle part, an org owner who also
// holds a league grant must land on the org — could be unit-tested instead of
// only observed in a browser. These assertions moved with it. The page keeps
// the terminal-state one below, because rendering is still the page's job.
const LANDING_DECISION_FILE = 'apps/web-admin/src/components/admin-landing-decision.ts';
requireContains(adminLandingDecisionText, LANDING_DECISION_FILE, 'me.admin?.platformRole');
requireContains(adminLandingDecisionText, LANDING_DECISION_FILE, "href: '/admin'");
requireContains(adminLandingDecisionText, LANDING_DECISION_FILE, 'href: `/org/${firstOrg.slug}`');
// The RETURN, not the union member. `kind: 'chooser'` alone also matches the
// `AdminLanding` type declaration a few lines above, so it stayed green while
// the branch that produces it was renamed away — verified by doing exactly that.
requireContains(
  adminLandingDecisionText,
  LANDING_DECISION_FILE,
  "{ kind: 'chooser', organizerSlug: firstOrg.slug }",
);
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
// The logout must carry the session cookie. It used to say so by spelling
// `credentials: 'include'` at the call site; it goes through the `apiRequest`
// seam now, which sends credentials by default and is the only place that
// decision is made. So pin the CALL, not the old snapshot.
//
// Not the import: an import survives the call being deleted, which is exactly
// what this pin has to fail on. Not a bare `apiRequest(` either — a site with a
// type argument reads `apiRequest<Row[]>(` — but this logout has no type
// argument, so pinning its real shape costs nothing and actually discriminates.
requireContains(
  superAdminShellText,
  'apps/web-admin/src/components/SuperAdminShell.tsx',
  "apiRequest(apiUrl, '/api/v1/auth/logout'",
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
  'useIdentityGate<',
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
// Same rule as the super-admin shell above: the seam owns `credentials`.
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  "apiRequest(apiUrl, '/api/v1/auth/logout'",
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  'organizer.shell.logout',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  'useIdentityGate<',
);
requireContains(
  organizerShellText,
  'apps/web-admin/src/components/OrganizerAdminShell.tsx',
  "window.location.replace('/login')",
);
// The hook the two lines above delegate to. Asserted here so the identity read
// is still pinned to exactly one place: without this, both shells could keep
// calling a hook that had stopped reading anything.
//
// QUOTED on purpose. `requireContains` is a substring match over the whole
// file, comments included, and this hook's own docstring names the route in
// prose — so the bare path was satisfied by the comment and the assertion
// passed on a hook pointed at a different URL entirely. The quotes make it
// match the string literal only.
requireContains(identityGateText, 'apps/web-admin/src/hooks/useIdentityGate.ts', "'/api/v1/me'");
requireContains(identityGateText, 'apps/web-admin/src/hooks/useIdentityGate.ts', 'apiRequest');
requireContains(
  identityGateText,
  'apps/web-admin/src/hooks/useIdentityGate.ts',
  'identityRetryDelayMs',
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
// `credentials: 'include'` is deliberately NOT pinned here any more, for the
// reason spelled out above AccountsPanel: this page used to spell the cookie
// decision at each call site, and `apiRequest` owns it now. Every substring a
// replacement pin could use is either the import — which survives the call
// being deleted — or a literal a type argument breaks. The route pin above
// still holds, and the real guard is `no-raw-api-fetch`, which now carries no
// exemption for this file: a hand-rolled fetch here reds the Lint job.
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
// The platform guard on this controller — and on users, fighters, clubs and
// dashboard-stats — is owned by platform-role-coverage.test.ts, which walks the
// real Nest metadata rather than the source text. Do not re-add a substring
// check here: the test pins each route's required TIER, fails on a new guarded
// route, fails on a deleted one, and is not fooled by the decorator moving
// between class and method level, which a substring cannot tell apart.
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
// `common.tooManyRequests` is deliberately NOT pinned here any more. The panel
// used to pick that sentence itself, per call site, with a `res.status === 429`
// ternary; `failureMessage` in @myclash/api-client owns it now. A substring pin
// would only re-assert the copy in the file that stopped choosing it, and the
// behaviour has a real guard instead: failure-message.test.ts requires the
// throttle sentence to beat a caller's fallback, and users/types.test.ts
// requires `readError` to carry it through. Both are falsified.
for (const expected of ['/api/v1/admin/users', 'actions.retry']) {
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
  requireContains(i18nText, 'packages/i18n/src/messages/en/**', expected);
}
for (const expected of [
  "@Patch(':id')",
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
// `common.tooManyRequests` is deliberately NOT pinned here any more, for the
// reason spelled out above AccountsPanel: the page used to pick that sentence
// itself, in a `readErrorMessage` helper with a `res.status === 429` branch.
// That helper is gone and `failureMessage` owns the rule, so a substring pin
// would only re-assert copy in the file that stopped choosing it.
for (const expected of [
  'startEditProfile',
  'admin.globalProfiles.clubCreateFromSearch',
  'searchAbv=true',
  'admin.globalProfiles.hemaRatingsId',
  'admin.globalProfiles.requiredNote',
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
  // `common.tooManyRequests` dropped here for the same reason as the fighters
  // console above: the 429 branch moved into `failureMessage`.
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
  requireContains(i18nText, 'packages/i18n/src/messages/en/**', expected);
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
  // Host identity/CPU/RAM comes from the docker daemon, and only this sidecar
  // has the socket. The projection is an allowlist because `docker info` also
  // carries proxy URLs that can embed credentials — see host-info.mjs.
  "url.pathname === '/host'",
  'parseDockerInfo',
  'HOST_INFO_TIMEOUT_MS',
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
  "@Controller('admin/dashboard-stats')",
);

for (const serviceName of ['api', 'web-public', 'web-staff', 'web-admin']) {
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
  // Derived, unlike the pinned COPY strings below: which packages need a
  // node_modules is read off their own dependencies. See the function.
  await assertApiImageShipsWorkspaceLinks(apiDockerfile.text, apiDockerfile.filePath);
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
    'COPY --chown=nestjs:nodejs apps/web-staff/package.json ./apps/web-staff/package.json',
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
assertManifestMountMatchesGenerator(systemVersionsLibText, 'infra/scripts/lib/system-versions.sh');
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
  'myclash-staff',
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

// Studio is a Next.js standalone server, so it binds to process.env.HOSTNAME —
// and the container runtime injects HOSTNAME=<container id> into every
// container. Without the override it listens on its own eth0 address alone:
// Traefik still reaches it, so the console looks perfectly fine, while the
// loopback healthcheck can never connect and the service sits unhealthy
// forever. That is exactly how it shipped. Our own Next images set this in
// their Dockerfiles; an image we don't build has to be told from compose.
for (const [label, serviceText] of [
  ['prod supabase-studio', services.get('supabase-studio') ?? ''],
  ['dev supabase-studio', devServices.get('supabase-studio') ?? ''],
]) {
  if (!serviceText.includes("HOSTNAME: '0.0.0.0'")) {
    errors.push(
      `${label} must set HOSTNAME: '0.0.0.0' — a Next standalone binds to the injected ` +
        'HOSTNAME, and a loopback healthcheck cannot reach it.',
    );
  }
}

// Studio keeps saved SQL Editor queries on DISK. Unset, the snippets route
// throws on every page load and answers 500 with the body {"data":[]} — a
// failure wearing a success shape — which is what took the whole SQL Editor
// down on 2026-08-21. Third instance of one class: a vendored upstream service
// keeps upstream's defaults for every key we dropped (POSTGRES_DB was the
// first, HOSTNAME above the second), so the keys we DID adopt get pinned here.
//
// The mount is pinned separately and is not decoration. With the variable set
// and the volume gone, Studio answers 200 and writes into the container
// filesystem, so every saved query dies on the next recreate — a failure no
// status-code probe can see. Nothing else in this gate asserts anything about
// a volume, so without these lines that variant would go unreported forever.
for (const [label, serviceText, fileLabel, fileText, volumeName, volumeAlias] of [
  [
    'prod supabase-studio',
    services.get('supabase-studio') ?? '',
    'infra/docker-compose.prod.yml',
    composeText,
    'myclash-studio-snippets',
    'studio_snippets',
  ],
  [
    'dev supabase-studio',
    devServices.get('supabase-studio') ?? '',
    'infra/docker-compose.dev.yml',
    devComposeText,
    'myclash-dev-studio-snippets',
    'dev_studio_snippets',
  ],
]) {
  requireContains(serviceText, label, 'SNIPPETS_MANAGEMENT_FOLDER: /app/snippets');
  requireContains(serviceText, label, `- ${volumeAlias}:/app/snippets`);
  // Asserted through its `name:` override rather than the `studio_snippets:`
  // key, for two reasons: the bare key also appears in the service mount above,
  // so it would pass while the declaration was gone, and a newline-anchored
  // string renders as an EMPTY error message — the failure names no line at
  // all, which is indistinguishable from an unrelated red.
  requireContains(fileText, fileLabel, `name: ${volumeName}`);
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
const shellScripts = (await pinned.readPinnedDir(scriptsDir)).filter((f) => f.endsWith('.sh'));
for (const name of shellScripts) {
  const text = await pinned.readPinnedFile(path.join(scriptsDir, name));
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
  const text = await pinned.readPinnedFile(path.join(scriptsDir, name));
  if (isMissingPinnedFile(text)) continue;
  if (!text.includes('mc_verify_edge_plugins')) {
    errors.push(
      `infra/scripts/${name} must call mc_verify_edge_plugins after bringing the stack up — ` +
        'otherwise a misconfigured plugin 404s the site with every other check green.',
    );
  }
}
// Parsed, not searched — so the sentinel has to be kept out of JSON.parse,
// which would throw on it exactly the way the raw read used to throw on ENOENT.
const rootPackageJsonText = await pinned.readPinnedFile(path.join(rootDir, 'package.json'));
if (!isMissingPinnedFile(rootPackageJsonText)) {
  const rootPackageJson = JSON.parse(rootPackageJsonText);
  if (rootPackageJson.scripts?.['infra:plugins'] !== 'node scripts/check-edge-plugins.mjs') {
    errors.push(
      'package.json must expose pnpm infra:plugins → node scripts/check-edge-plugins.mjs.',
    );
  }
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
  'myclash-admin-staff': 'admin',
  'myclash-traefik-dashboard': 'admin',
  'myclash-public': 'public',
  'myclash-marketing': 'public',
  'myclash-staff': 'public',
  'myclash-staff-prefixed': 'public',
  'myclash-staff-api': 'public',
  'myclash-staff-auth': 'public',
  // The admin-host twin of the host-less staff-auth router. It exists purely
  // to keep this path on the admin allow-list: without it the host-less
  // router wins on admin. too and silently widens geo access there.
  'myclash-staff-auth-admin': 'admin',
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

// Fail2Ban guards LOGIN surfaces only. Both jails count 401/403, which on a
// router carrying authenticated app traffic is a ban on real people rather than
// on an attacker — see the refusal list below.
const fail2banRouters = {
  'myclash-auth': 'MW_F2B_AUTH',
  'myclash-studio': 'MW_F2B_AUTH',
  'myclash-traefik-dashboard': 'MW_F2B_AUTH',
  // Both halves of the staff-auth pair, or the endpoint goes back to being
  // unjailed on whichever host is missing.
  'myclash-staff-auth': 'MW_F2B_STAFF',
  'myclash-staff-auth-admin': 'MW_F2B_STAFF',
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

// The API routers that must stay UNJAILED, and why.
//
// Anchored on `routers.<name>.middlewares=` so `myclash-staff-api` cannot be
// satisfied by a match inside `myclash-staff-auth`, and matching BOTH spellings:
// prod chains the jails through `${MW_F2B_*}` for the TRAEFIK_PLUGINS=off
// kill-switch, so a rule looking only for the literal `fail2ban` would have been
// a refusal that could never fire on this file.
const unjailedApiRouters = {
  'myclash-admin-api':
    'expired sliding sessions emit parallel 401 bursts that would ban legitimate admins. ' +
    'The admin country allow-list is the control there.',
  'myclash-staff-api':
    'it carries every authenticated call the scoring pad makes, and a venue shares one ' +
    "NAT'd address. The pad's 20-second heartbeat sat in the root layout until 2026-08-21, " +
    'so a signed-out tablet posted three 401s a minute indefinitely against a threshold of ' +
    "60 in 10 minutes. The API's own ThrottlerGuard is the control there.",
};
for (const [router, why] of Object.entries(unjailedApiRouters)) {
  const pattern = new RegExp(
    `routers\\.${escapeRegExp(router)}\\.middlewares=[^\\n]*(fail2ban|\\$\\{MW_F2B_)`,
    'u',
  );
  if (pattern.test(composeText)) {
    errors.push(`${router} must NOT chain fail2ban: ${why}`);
  }
}

// Dev's staff routers, mirroring prod's. Dev is where a router shape is first
// exercised, so a jail that exists only in prod is one that reaches the live
// edge untested — the same reasoning that pins the plugin versions identical.
// Literal middleware names, not ${MW_*}: the kill-switch is prod-only.
const devStaffRouters = {
  'dev-staff-auth': 'myclash-geoblock-public@file',
  'dev-staff-auth-admin': 'myclash-geoblock-admin@file',
};
for (const [router, geoblock] of Object.entries(devStaffRouters)) {
  const pattern = new RegExp(
    `traefik\\.http\\.routers\\.${escapeRegExp(router)}\\.middlewares=${escapeRegExp(geoblock)},myclash-fail2ban-staff@docker`,
    'u',
  );
  if (!pattern.test(devComposeText)) {
    errors.push(
      `infra/docker-compose.dev.yml router ${router} must chain ${geoblock} then ` +
        'myclash-fail2ban-staff@docker, matching its prod twin.',
    );
  }
}

// The dev twins of the unjailed API routers above. Pinned as a REFUSAL rather
// than merely dropped from the list: a router that is only "no longer asserted"
// is one the next edit can quietly re-jail, and the two files drift apart again
// — which is how dev-api came to carry the jail under a comment claiming it
// matched prod's myclash-api, which never had one.
for (const router of ['dev-api', 'dev-staff-api', 'dev-admin-api']) {
  const pattern = new RegExp(
    `routers\\.${escapeRegExp(router)}\\.middlewares=[^\\n]*fail2ban`,
    'u',
  );
  if (pattern.test(devComposeText)) {
    errors.push(
      `infra/docker-compose.dev.yml router ${router} must NOT chain fail2ban: it carries ` +
        'authenticated app traffic, and the jails count 401/403. Same reason as its prod twin.',
    );
  }
}

// Priority is what makes the pair a control rather than a decoration: the
// host-less router has to beat dev-admin-api's 30 and dev-api's rule-length
// default, and the admin twin has to beat the host-less one or admin. silently
// drops onto the public country allow-list. dev-staff-api sits at 30 — above
// dev-staff's rule-length default, BELOW the staff-auth pair so the PIN-login
// jail keeps winning on its own path.
for (const [router, priority] of [
  ['dev-staff-auth', 40],
  ['dev-staff-auth-admin', 50],
  ['dev-staff-api', 30],
]) {
  const pattern = new RegExp(
    `traefik\\.http\\.routers\\.${escapeRegExp(router)}\\.priority=(\\d+)`,
    'u',
  );
  const match = pattern.exec(devComposeText);
  if (match?.[1] !== String(priority)) {
    errors.push(
      `infra/docker-compose.dev.yml router ${router} must set priority=${priority} ` +
        `(found ${match?.[1] ?? 'none'}).`,
    );
  }
}

// Both jails must count 403 as well as 401. A disabled staff account answers
// 403, not 401, so without it an attacker can enumerate which usernames exist
// and which have been switched off for free. Nothing else pins this value, and
// a silent drift back to `401,429` looks identical from the outside.
for (const [label, text] of [
  ['infra/docker-compose.prod.yml', composeText],
  ['infra/docker-compose.dev.yml', devComposeText],
]) {
  for (const jail of ['myclash-fail2ban-auth', 'myclash-fail2ban-staff']) {
    const pattern = new RegExp(
      `middlewares\\.${escapeRegExp(jail)}\\.plugin\\.fail2ban\\.rules\\.statuscode=([^\\n]*)`,
      'u',
    );
    const match = pattern.exec(text);
    if (!match) {
      errors.push(`${label} must set ${jail} statuscode.`);
    } else if (match[1].trim() !== '401,403,429') {
      errors.push(
        `${label} ${jail} statuscode must be 401,403,429 (found ${match[1].trim()}). ` +
          '403 covers disabled accounts; without it, probing for them is uncounted.',
      );
    }
  }
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
  'dev-staff': 'public',
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
// dev-api is NOT here. It carried myclash-fail2ban-staff@docker under a comment
// claiming that matched prod's myclash-api, which has never chained a jail — so
// this rule enforced the drift it was written to prevent. The refusal above is
// what pins it now.
for (const [router, middleware] of Object.entries({
  'dev-auth': 'myclash-fail2ban-auth@docker',
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

// Not every pinned path is opened in the sweep at the top — the shell-script
// checks and the package.json read happen far below it. Drain whatever the
// reader recorded since, so a path that goes missing late is reported too
// rather than passing silently because the first drain had already run.
for (const missingPath of pinned.missing) {
  if (reportedMissing.has(missingPath)) continue;
  reportedMissing.add(missingPath);
  errors.push(`Pinned file is missing: ${missingPath} — this gate reads that path.`);
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

console.log(
  `Infrastructure review passed: ${assertionsRun} text assertions over ${pinned.read.size} ` +
    `pinned files, including ${requiredServices.length} compose services.`,
);

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
  // A file that is not there owns no facts. Without this, one rename reports
  // "is missing X" once per assertion that named the file — eleven lines for
  // AccountsTable.tsx alone — and buries the one finding that explains them.
  if (isMissingPinnedFile(text)) return;
  assertionsRun += 1;
  if (!text.includes(expected)) errors.push(`${serviceName} is missing ${expected}`);
}

/**
 * Where a service's healthcheck comes from, or null if it has none.
 *
 * A compose `healthcheck:` overrides the image's; a service that builds from one
 * of our Dockerfiles inherits that image's HEALTHCHECK when compose stays quiet.
 * `worker` has always relied on the second path, which is why it was excluded by
 * name from the compose requirement — this resolves the same fact by reading.
 */
function healthcheckOwner(serviceText) {
  if (serviceText.includes('healthcheck:')) return 'compose';
  const dockerfile = /^\s*dockerfile:\s*(\S+)\s*$/mu.exec(serviceText)?.[1];
  if (!dockerfile) return null;
  const image = dockerfiles.find((entry) => entry.filePath === dockerfile);
  return image?.text.includes('HEALTHCHECK') ? 'image' : null;
}

/** Read a `NAME=(a b c)` bash array out of a script, or null if absent. */
function parseBashArray(text, name) {
  const match = new RegExp(`${escapeRegExp(name)}=\\(([^)]*)\\)`, 'u').exec(text);
  return match ? match[1].split(/\s+/u).filter(Boolean) : null;
}

/**
 * The api container reads its deploy manifest through a bind mount; the deploy
 * scripts write that file from the repo root. Those two paths must resolve to
 * the same file — and they are resolved against DIFFERENT bases, which is why
 * they silently disagreed for as long as they did.
 *
 * Compose resolves a relative bind source against its *project directory*,
 * which defaults to the directory of the first `-f` file (`infra/`), not the
 * directory the script was invoked from. So `./data/system-versions.json` in
 * the compose file meant `infra/data/system-versions.json` while deploy.sh
 * wrote `<root>/data/system-versions.json`. Compose then created a DIRECTORY at
 * the missing source, the API's EISDIR guard degraded to its fallback manifest,
 * and the admin board reported "unknown" for the deploy date, the deployer and
 * the backup file with no error anywhere. Repo-root paths must use `../`.
 *
 * `generatorText` is whichever file owns the `--output` argument — deploy.sh
 * today, the shared shell lib once the writer has one owner.
 */
function assertManifestMountMatchesGenerator(generatorText, generatorLabel) {
  const apiService = services.get('api');
  if (!apiService) {
    errors.push('infra/docker-compose.prod.yml must define an api service.');
    return;
  }
  const mountMatch = /^\s*-\s*(\S+?):\/app\/data\/system-versions\.json(?::[a-z,]+)?\s*$/mu.exec(
    apiService,
  );
  if (!mountMatch) {
    errors.push(
      'infra/docker-compose.prod.yml api service must bind-mount the deploy manifest at /app/data/system-versions.json.',
    );
    return;
  }
  const outputMatch = /generate-system-versions\.mjs[\s\S]{0,400}?--output\s+(\S+)/u.exec(
    generatorText,
  );
  if (!outputMatch) {
    errors.push(`${generatorLabel} must pass --output to scripts/generate-system-versions.mjs.`);
    return;
  }
  const mounted = path.resolve(path.join(rootDir, 'infra'), mountMatch[1]);
  const written = path.resolve(rootDir, outputMatch[1]);
  if (mounted !== written) {
    errors.push(
      `The api deploy-manifest mount resolves to ${mounted} but ${generatorLabel} writes ${written}. ` +
        "Compose resolves relative bind sources against infra/ (the first -f file's directory), " +
        'not the repo root — use ../ for repo-root paths.',
    );
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * A workspace package the api image ships must ship its `node_modules` too.
 *
 * ── The outage this closes ──────────────────────────────────────────────────
 * pnpm links a workspace dependency into the DEPENDENT's `node_modules`, so
 * `@myclash/types` depending on `@myclash/rules` means a link at
 * `packages/types/node_modules/@myclash/rules`. The api Dockerfile's runner
 * stage copies each package's `dist` and `package.json` by hand, and copies
 * `node_modules` for some of them.
 *
 * `packages/types` was missed. The api and the worker both crash-looped on
 * `Cannot find module '@myclash/rules'` thrown from
 * `packages/types/dist/match-clock.js`, and prod was down until the COPY was
 * added. Node had a dist it could load and no way to resolve what that dist
 * required.
 *
 * Nothing could have caught it earlier. The image BUILDS fine either way,
 * because the builder stage has the whole workspace — only a container that
 * actually starts can fail this way, and no gate starts one. The hand-written
 * COPY list simply went stale the moment a package gained its first dependency.
 *
 * ── Why it is derived ───────────────────────────────────────────────────────
 * The requirement is read off each package's own `dependencies`, not pinned as
 * a list here. A second list would rot exactly the way the Dockerfile's did.
 * Declaring a dependency is the act that creates the need, so that is what this
 * reads.
 *
 * Only the missing direction is a finding. A COPY of a `node_modules` that no
 * longer exists fails the docker build loudly, so Docker already owns it.
 *
 * Only `COPY --from=` lines count. The runner also copies four web-app
 * `package.json` files straight from the build context, as DATA for the version
 * service — those are not part of the module tree and must not be asked for a
 * `node_modules`. Being copied out of an earlier stage is what makes a workspace
 * something Node will resolve through at runtime.
 *
 * The three Next images are deliberately out of scope: `output: 'standalone'`
 * traces the runtime tree itself instead of copying packages by hand.
 */
async function assertApiImageShipsWorkspaceLinks(dockerfileText, dockerfileLabel) {
  if (isMissingPinnedFile(dockerfileText)) return;

  const {
    manifests: copiedManifests,
    modules: copiedModules,
    hasRunnerStage,
  } = runnerStageWorkspaces(dockerfileText);
  if (!hasRunnerStage) {
    errors.push(`${dockerfileLabel} must define a runner stage.`);
    return;
  }

  if (copiedManifests.size === 0) {
    errors.push(
      `${dockerfileLabel}: no workspace package.json COPY lines found in the runner stage — ` +
        'this check reads those to know what the image ships, so its pattern has rotted.',
    );
    return;
  }

  for (const workspace of [...copiedManifests].sort()) {
    const manifestText = await pinned.readPinnedFile(
      path.join(rootDir, ...workspace.split('/'), 'package.json'),
    );
    if (isMissingPinnedFile(manifestText)) continue;

    let dependencies;
    try {
      dependencies = Object.keys(JSON.parse(manifestText).dependencies ?? {});
    } catch {
      errors.push(`${workspace}/package.json is not valid JSON.`);
      continue;
    }

    if (dependencies.length > 0 && !copiedModules.has(workspace)) {
      errors.push(
        `${dockerfileLabel} ships ${workspace} but not ${workspace}/node_modules, and that ` +
          `package depends on ${dependencies.join(', ')}. pnpm links a dependency into the ` +
          'DEPENDENT\'s node_modules, so the container will throw "Cannot find module" at boot ' +
          'while the image builds perfectly. Add the COPY next to the package.json one.',
      );
    }
  }
}
