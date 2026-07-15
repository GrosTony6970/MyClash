import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const controllerRoot = join(root, 'apps', 'api', 'src', 'modules');
const validPostures = new Set([
  'public',
  'auth',
  'guest',
  'staff',
  'organizer',
  'org_admin',
  'super_admin',
  'mixed',
]);

const inventory = {
  'apps/api/src/modules/admin/ai-data-quality.controller.ts': 'super_admin',
  'apps/api/src/modules/admin/audit-log.controller.ts': 'super_admin',
  'apps/api/src/modules/admin/backups.controller.ts': 'super_admin',
  'apps/api/src/modules/admin/exchange-edit-requests.controller.ts': 'super_admin',
  'apps/api/src/modules/admin/feature-flags.controller.ts': 'super_admin',
  'apps/api/src/modules/admin/organizations.controller.ts': 'super_admin',
  'apps/api/src/modules/admin/platform-ai-settings.controller.ts': 'super_admin',
  'apps/api/src/modules/admin/rulesets.controller.ts': 'super_admin',
  'apps/api/src/modules/admin/system-versions.controller.ts': 'super_admin',
  'apps/api/src/modules/admin/users.controller.ts': 'super_admin',
  'apps/api/src/modules/ai-providers/ai-providers.controller.ts': 'org_admin',
  'apps/api/src/modules/ai-usage/ai-usage.controller.ts': 'org_admin',
  'apps/api/src/modules/auth/auth.controller.ts': 'public',
  'apps/api/src/modules/auth/guest-sessions.controller.ts': 'guest',
  'apps/api/src/modules/auth/me.controller.ts': 'mixed',
  'apps/api/src/modules/auth/signup.controller.ts': 'public',
  'apps/api/src/modules/clubs/clubs.controller.ts': 'mixed',
  'apps/api/src/modules/compensation/compensation.controller.ts': 'organizer',
  'apps/api/src/modules/events/events.controller.ts': 'mixed',
  'apps/api/src/modules/exports/exports.controller.ts': 'organizer',
  'apps/api/src/modules/fighters/fighters.controller.ts': 'mixed',
  'apps/api/src/modules/follows/follows.controller.ts': 'auth',
  'apps/api/src/modules/health/health.controller.ts': 'public',
  'apps/api/src/modules/hema-ratings/hema-ratings.controller.ts': 'organizer',
  'apps/api/src/modules/leagues/leagues.controller.ts': 'mixed',
  'apps/api/src/modules/lices/lices.controller.ts': 'organizer',
  'apps/api/src/modules/matches/matches.controller.ts': 'mixed',
  'apps/api/src/modules/notifications/broadcast-notifications.controller.ts': 'organizer',
  'apps/api/src/modules/notifications/notifications.controller.ts': 'auth',
  'apps/api/src/modules/organizations/organizations.controller.ts': 'mixed',
  'apps/api/src/modules/organizer-ai-assistant/organizer-ai-assistant.controller.ts': 'org_admin',
  'apps/api/src/modules/penalties/penalties.controller.ts': 'staff',
  'apps/api/src/modules/persons/lookup.controller.ts': 'public',
  'apps/api/src/modules/persons/person-email-change.controller.ts': 'auth',
  'apps/api/src/modules/persons/persons.controller.ts': 'mixed',
  'apps/api/src/modules/persons/privacy.controller.ts': 'auth',
  'apps/api/src/modules/persons/public-schedule.controller.ts': 'public',
  'apps/api/src/modules/phases/bracket-slots.controller.ts': 'mixed',
  'apps/api/src/modules/phases/conflict-check.controller.ts': 'organizer',
  'apps/api/src/modules/phases/phases.controller.ts': 'mixed',
  'apps/api/src/modules/programme/programme.controller.ts': 'mixed',
  'apps/api/src/modules/referees/auto-assign.controller.ts': 'organizer',
  'apps/api/src/modules/referees/qualifications.controller.ts': 'organizer',
  'apps/api/src/modules/referees/settings.controller.ts': 'organizer',
  'apps/api/src/modules/registrations/registrations.controller.ts': 'mixed',
  'apps/api/src/modules/schedule/live-state.controller.ts': 'mixed',
  'apps/api/src/modules/schedule/my-schedule.controller.ts': 'mixed',
  'apps/api/src/modules/staff/staff.controller.ts': 'mixed',
  'apps/api/src/modules/stats/stats.controller.ts': 'mixed',
  'apps/api/src/modules/tournament-query/tournament-query.controller.ts': 'organizer',
  'apps/api/src/modules/workshops/workshops.controller.ts': 'mixed',
};

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const controllers = walk(controllerRoot)
  .filter((path) => path.endsWith('.controller.ts'))
  .map((path) => relative(root, path).split(sep).join('/'))
  .sort();

const inventoryPaths = Object.keys(inventory).sort();
const missing = controllers.filter((path) => !inventory[path]);
const stale = inventoryPaths.filter((path) => !controllers.includes(path));
const invalid = Object.entries(inventory).filter(([, posture]) => !validPostures.has(posture));

if (missing.length || stale.length || invalid.length) {
  if (missing.length) {
    console.error('Unclassified API controllers:');
    for (const path of missing) console.error(`  - ${path}`);
  }
  if (stale.length) {
    console.error('Stale API route-security inventory entries:');
    for (const path of stale) console.error(`  - ${path}`);
  }
  if (invalid.length) {
    console.error('Invalid API route-security postures:');
    for (const [path, posture] of invalid) console.error(`  - ${path}: ${posture}`);
  }
  process.exit(1);
}

const routeCount = controllers.reduce((count, path) => {
  const source = readFileSync(join(root, path), 'utf8');
  return count + (source.match(/@(Get|Post|Put|Patch|Delete)\(/g) ?? []).length;
}, 0);

console.log(
  `Route security inventory covers ${controllers.length} controllers and ${routeCount} routes.`,
);
