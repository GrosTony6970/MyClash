/**
 * The anti-drift net for the platform-tier sweep.
 *
 * `PlatformRoleGuard` derives a route's required tier from its HTTP verb plus
 * an optional `@PlatformRole` decorator. That default is safe — a forgotten
 * decorator RESERVES a write to super-admins rather than opening one — but a
 * WRONG decorator is completely silent: nothing fails to compile, no other
 * test fails, and the mistake surfaces only as an access-control bug in
 * production. Twenty-six controllers were swept by hand; this file is what
 * makes that sweep reviewable and stops it rotting.
 *
 * The table pins the required tier of EVERY guarded route in the API. The test
 * walks the real Nest metadata, so:
 *
 *   - changing a decorator fails the tier assertion,
 *   - adding a guarded route fails "classifies every guarded route",
 *   - deleting or renaming one fails "has no stale rows",
 *   - moving a route to another path fails both.
 *
 * When one fires, decide the tier deliberately and edit the table. Do not
 * regenerate it wholesale — the point is that a human classified each line.
 *
 * Tiers: `platform_viewer` = any platform account (reads), `platform_admin` =
 * moderation and catalogue work, `super_admin` = the reserve (accounts and
 * roles, destructive infra, kill switches and secrets, GDPR).
 */
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PLATFORM_ROLES, type PlatformRole } from '@myclash/types';
import { describe, expect, it } from 'vitest';

import { AIDataQualityController } from '../ai-data-quality.controller';
import { AuditLogAdminController } from '../audit-log.controller';
import { BackupsAdminController } from '../backups.controller';
import { ClaimRequestsAdminController } from '../claim-requests.controller';
import { CustomRulesetsAdminController } from '../custom-rulesets/custom-rulesets.controller';
import { AdminDashboardStatsController } from '../dashboard-stats.controller';
import { ExchangeEditRequestsAdminController } from '../exchange-edit-requests.controller';
import { FeatureFlagsAdminController } from '../feature-flags.controller';
import { HemaRatingsAdminController } from '../hema-ratings-admin.controller';
import { LeagueScoringSystemsController } from '../league-scoring-systems/league-scoring-systems.controller';
import { NotificationsSummaryController } from '../notifications-summary.controller';
import { OrganizationsAdminController } from '../organizations.controller';
import { PlatformAIKeysController } from '../platform-ai-keys.controller';
import { PlatformAISettingsController } from '../platform-ai-settings.controller';
import { PlatformAIUsageController } from '../platform-ai-usage.controller';
import { PlatformLogAdminController } from '../platform-log.controller';
import { ReviewQueueController } from '../review-queue.controller';
import { RuntimeHealthAdminController } from '../runtime-health.controller';
import { SystemVersionsAdminController } from '../system-versions.controller';
import { TlsStatusAdminController } from '../tls-status.controller';
import { UsersAdminController } from '../users.controller';
import { WeaponsAdminController } from '../weapons/weapons-admin.controller';
import { ClubsController } from '../../clubs/clubs.controller';
import { FightersController, GlobalPersonsController } from '../../fighters/fighters.controller';
import { OrganizationsController } from '../../organizations/organizations.controller';
import { PrivacyAdminController } from '../../privacy/privacy-admin.controller';
import { PLATFORM_ROLE_KEY } from './platform-role.decorator';
import { PlatformRoleGuard } from './platform-role.guard';

type Ctor = new (...args: never[]) => object;

/** Every controller that attaches PlatformRoleGuard, at class or method level. */
const CONTROLLERS: Ctor[] = [
  AIDataQualityController,
  AuditLogAdminController,
  BackupsAdminController,
  ClaimRequestsAdminController,
  CustomRulesetsAdminController,
  AdminDashboardStatsController,
  ExchangeEditRequestsAdminController,
  FeatureFlagsAdminController,
  HemaRatingsAdminController,
  LeagueScoringSystemsController,
  NotificationsSummaryController,
  OrganizationsAdminController,
  PlatformAIKeysController,
  PlatformAISettingsController,
  PlatformAIUsageController,
  PlatformLogAdminController,
  ReviewQueueController,
  RuntimeHealthAdminController,
  SystemVersionsAdminController,
  TlsStatusAdminController,
  UsersAdminController,
  WeaponsAdminController,
  ClubsController,
  FightersController,
  GlobalPersonsController,
  OrganizationsController,
  PrivacyAdminController,
];

const VERBS: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.HEAD]: 'HEAD',
};

const EXPECTED = new Map<string, PlatformRole>([
  ['DELETE /admin/ai-keys/:id', 'super_admin'],
  ['DELETE /admin/backups', 'super_admin'],
  ['DELETE /admin/backups/:backupId', 'super_admin'],
  ['DELETE /admin/custom-rulesets/:id', 'platform_admin'],
  ['DELETE /admin/league-scoring-systems/:id', 'platform_admin'],
  ['DELETE /admin/organizations/:id', 'super_admin'],
  ['DELETE /admin/users/:id', 'super_admin'],
  ['DELETE /admin/users/:id/organizations/:orgId', 'super_admin'],
  ['DELETE /admin/users/:id/temp-password', 'super_admin'],
  ['DELETE /admin/users/:id/platform-role', 'super_admin'],
  ['DELETE /admin/weapons/:id', 'platform_admin'],
  ['DELETE /clubs/:id', 'platform_admin'],
  ['DELETE /clubs/:id/logo', 'platform_admin'],
  ['GET /admin/ai-keys', 'super_admin'],
  ['GET /admin/ai-settings', 'super_admin'],
  ['GET /admin/ai-usage/summary', 'platform_viewer'],
  ['GET /admin/audit-log', 'platform_viewer'],
  ['GET /admin/audit-log/export.csv', 'super_admin'],
  ['GET /admin/backups', 'super_admin'],
  ['GET /admin/backups/:backupId/download', 'super_admin'],
  ['GET /admin/backups/operations/:operationId', 'super_admin'],
  ['GET /admin/backups/schedule', 'super_admin'],
  ['GET /admin/backups/status', 'super_admin'],
  ['GET /admin/custom-rulesets', 'platform_viewer'],
  ['GET /admin/custom-rulesets/:id', 'platform_viewer'],
  ['GET /admin/custom-rulesets/:id/versions', 'platform_viewer'],
  ['GET /admin/dashboard-stats', 'platform_viewer'],
  ['GET /admin/data-quality/findings', 'platform_viewer'],
  ['GET /admin/data-quality/scans', 'platform_viewer'],
  ['GET /admin/data-retention', 'super_admin'],
  ['GET /admin/exchange-edit-requests', 'platform_viewer'],
  ['GET /admin/feature-flags', 'super_admin'],
  ['GET /admin/global-person-claim-requests', 'platform_viewer'],
  ['GET /admin/hema-ratings/fighters', 'platform_viewer'],
  ['GET /admin/hema-ratings/health', 'platform_viewer'],
  ['GET /admin/hema-ratings/sync-history', 'platform_viewer'],
  ['GET /admin/notifications/summary', 'platform_viewer'],
  ['GET /admin/organizations', 'platform_viewer'],
  ['GET /admin/organizations/:id', 'platform_viewer'],
  ['GET /admin/platform-log', 'platform_viewer'],
  ['GET /admin/review-queue', 'platform_viewer'],
  ['GET /admin/system-versions', 'platform_viewer'],
  ['GET /admin/system/runtime-health', 'platform_viewer'],
  ['GET /admin/system/runtime-health/series', 'platform_viewer'],
  ['GET /admin/system/runtime-health/alert-settings', 'platform_viewer'],
  ['GET /admin/system/tls-status', 'platform_viewer'],
  ['GET /admin/users', 'platform_viewer'],
  ['GET /admin/users/:id', 'platform_viewer'],
  ['GET /admin/users/:id/temp-password', 'super_admin'],
  ['GET /admin/weapons', 'platform_viewer'],
  ['GET /clubs/review-requests', 'platform_viewer'],
  ['GET /fighters/merge/audit-log', 'platform_viewer'],
  ['GET /organizations', 'platform_viewer'],
  ['PATCH /admin/ai-keys/:id', 'super_admin'],
  ['PATCH /admin/ai-settings/budget', 'super_admin'],
  ['PATCH /admin/custom-rulesets/:id', 'platform_admin'],
  ['PATCH /admin/data-quality/findings/:id', 'platform_admin'],
  ['PATCH /admin/data-retention', 'super_admin'],
  ['PATCH /admin/league-scoring-systems/:id', 'platform_admin'],
  ['PATCH /admin/league-scoring-systems/:id/set-default', 'platform_admin'],
  ['PATCH /admin/organizations/:id', 'platform_admin'],
  ['PATCH /admin/organizations/:id/approve', 'platform_admin'],
  ['PATCH /admin/organizations/:id/reactivate', 'platform_admin'],
  ['PATCH /admin/organizations/:id/suspend', 'platform_admin'],
  ['PATCH /admin/users/:id', 'super_admin'],
  ['PATCH /admin/users/:id/disable', 'platform_admin'],
  ['PATCH /admin/users/:id/enable', 'platform_admin'],
  ['PATCH /admin/users/:id/organizations/:orgId', 'super_admin'],
  ['PATCH /admin/weapons/:id', 'platform_admin'],
  ['PATCH /clubs/:id/unverify', 'platform_admin'],
  ['PATCH /clubs/:id/verify', 'platform_admin'],
  ['PATCH /global-persons/:id', 'platform_admin'],
  ['POST /admin/ai-keys', 'super_admin'],
  ['POST /admin/ai-keys/:id/activate', 'super_admin'],
  ['POST /admin/ai-keys/:id/model-sync', 'super_admin'],
  ['POST /admin/ai-settings/model-sync', 'super_admin'],
  ['POST /admin/backups/restore', 'super_admin'],
  ['POST /admin/backups/run', 'super_admin'],
  ['POST /admin/backups/upload', 'super_admin'],
  ['POST /admin/custom-rulesets', 'platform_admin'],
  ['POST /admin/custom-rulesets/:id/approve-public', 'platform_admin'],
  ['POST /admin/custom-rulesets/:id/clone', 'platform_admin'],
  ['POST /admin/custom-rulesets/:id/publish', 'platform_admin'],
  ['POST /admin/custom-rulesets/:id/reject-submission', 'platform_admin'],
  ['POST /admin/custom-rulesets/:id/set-default', 'platform_admin'],
  ['POST /admin/custom-rulesets/:id/unpublish', 'platform_admin'],
  ['POST /admin/custom-rulesets/:id/versions/:versionId/rollback', 'platform_admin'],
  ['POST /admin/custom-rulesets/validate', 'platform_admin'],
  ['POST /admin/data-quality/scans', 'platform_admin'],
  ['POST /admin/data-retention/run', 'super_admin'],
  ['POST /admin/exchange-edit-requests/:id/approve', 'platform_admin'],
  ['POST /admin/exchange-edit-requests/:id/reject', 'platform_admin'],
  ['POST /admin/global-person-claim-requests/:id/approve', 'platform_admin'],
  ['POST /admin/global-person-claim-requests/:id/reject', 'platform_admin'],
  ['POST /admin/global-persons/:id/anonymise', 'super_admin'],
  ['POST /admin/hema-ratings/fighters/:globalPersonId/refresh', 'platform_admin'],
  ['POST /admin/hema-ratings/sync', 'platform_admin'],
  ['POST /admin/league-scoring-systems', 'platform_admin'],
  ['POST /admin/league-scoring-systems/:id/clone', 'platform_admin'],
  ['POST /admin/organizations', 'platform_admin'],
  ['POST /admin/organizations/:id/reassign-owner', 'platform_admin'],
  ['POST /admin/review-queue/:type/:id/approve', 'platform_admin'],
  ['POST /admin/review-queue/:type/:id/reject', 'platform_admin'],
  ['POST /admin/system-versions/components/:key/:action', 'super_admin'],
  ['POST /admin/system/tls-status/renew', 'super_admin'],
  ['POST /admin/users', 'super_admin'],
  ['POST /admin/users/:id/regenerate-temp-password', 'super_admin'],
  ['POST /admin/users/:id/send-password-reset', 'super_admin'],
  ['POST /admin/users/:id/organizations', 'super_admin'],
  ['POST /admin/weapons', 'platform_admin'],
  ['POST /clubs/:id/logo', 'platform_admin'],
  ['POST /clubs/bulk-archive', 'platform_admin'],
  ['POST /clubs/bulk-cleanup-delete', 'platform_admin'],
  ['POST /clubs/bulk-delete', 'platform_admin'],
  ['POST /clubs/bulk-unverify', 'platform_admin'],
  ['POST /clubs/bulk-update', 'platform_admin'],
  ['POST /clubs/bulk-verify', 'platform_admin'],
  ['POST /clubs/review-requests/:id/approve', 'platform_admin'],
  ['POST /clubs/review-requests/:id/link', 'platform_admin'],
  ['POST /clubs/review-requests/:id/reject', 'platform_admin'],
  ['POST /fighters/merge', 'platform_admin'],
  ['POST /fighters/merge/:auditLogId/revert', 'platform_admin'],
  ['POST /global-persons/import', 'platform_admin'],
  ['POST /global-persons/import/preview', 'platform_admin'],
  ['PUT /admin/backups/schedule', 'super_admin'],
  ['PUT /admin/feature-flags/:key', 'super_admin'],
  ['PUT /admin/users/:id/platform-role', 'super_admin'],
  ['PUT /admin/system/runtime-health/alert-settings', 'super_admin'],
  ['POST /admin/league-scoring-systems/:id/versions/:versionId/rollback', 'platform_admin'],
]);

interface Route {
  key: string;
  tier: PlatformRole;
  where: string;
  isRead: boolean;
}

/**
 * Walk the Nest metadata and re-derive each guarded route's tier with the same
 * formula the guard uses. Deliberately a reimplementation rather than a call
 * into the guard: if someone changes the formula, this should fail and make
 * them come here and say why.
 */
function guardedRoutes(): Route[] {
  const routes: Route[] = [];
  for (const ctrl of CONTROLLERS) {
    const base = (Reflect.getMetadata(PATH_METADATA, ctrl) as string) ?? '';
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, ctrl) ?? []) as unknown[];
    const classTier = Reflect.getMetadata(PLATFORM_ROLE_KEY, ctrl) as string | undefined;

    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      if (name === 'constructor') continue;
      const handler = (ctrl.prototype as Record<string, unknown>)[name] as object;
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (verb === undefined) continue;

      const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
      const guarded =
        methodGuards.includes(PlatformRoleGuard) || classGuards.includes(PlatformRoleGuard);
      if (!guarded) continue;

      const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string) ?? '';
      const explicit = ((Reflect.getMetadata(PLATFORM_ROLE_KEY, handler) as string | undefined) ??
        classTier) as 'platform_admin' | 'super_admin' | undefined;
      const isRead = verb === RequestMethod.GET || verb === RequestMethod.HEAD;
      const tier: PlatformRole = isRead
        ? explicit === 'super_admin'
          ? 'super_admin'
          : 'platform_viewer'
        : (explicit ?? 'super_admin');

      const path = `/${base}/${sub}`.replace(/\/{2,}/gu, '/').replace(/(.)\/$/u, '$1');
      routes.push({ key: `${VERBS[verb]} ${path}`, tier, where: `${ctrl.name}.${name}`, isRead });
    }
  }
  return routes;
}

describe('platform tier coverage', () => {
  const routes = guardedRoutes();

  it('classifies every guarded route', () => {
    const unclassified = routes.filter((r) => !EXPECTED.has(r.key));
    expect(
      unclassified.map((r) => `${r.key}  (${r.where})`),
      'new guarded routes must be given a tier in EXPECTED',
    ).toEqual([]);
  });

  it('has no stale rows', () => {
    const live = new Set(routes.map((r) => r.key));
    expect(
      [...EXPECTED.keys()].filter((k) => !live.has(k)),
      'these rows no longer match a route — renamed, moved or deleted',
    ).toEqual([]);
  });

  it('requires the pinned tier on each route', () => {
    const wrong = routes
      .filter((r) => EXPECTED.has(r.key) && EXPECTED.get(r.key) !== r.tier)
      .map((r) => `${r.key}: expected ${EXPECTED.get(r.key)}, got ${r.tier} (${r.where})`);
    expect(wrong).toEqual([]);
  });

  it('never leaves a write reachable by a platform viewer', () => {
    // The invariant restated independently of the table: whatever the tiers
    // say, no non-GET route may be open to the read-only tier.
    const open = routes.filter((r) => !r.isRead && r.tier === 'platform_viewer');
    expect(open.map((r) => r.key)).toEqual([]);
  });

  it('reserves the routes that hand out secrets or destroy things', () => {
    // Spot-checks with a stated reason, so a careless bulk edit to EXPECTED
    // still trips something. Each of these would be a real incident.
    const reserved = [
      'GET /admin/users/:id/temp-password', // returns a plaintext credential
      'GET /admin/audit-log/export.csv', // bulk personal data leaving the platform
      'GET /admin/ai-keys', // BYOK secret values
      'GET /admin/feature-flags', // the lockdown + read-only kill switches
      'GET /admin/backups/:backupId/download', // streams the database
      'GET /admin/data-retention', // GDPR configuration
      'POST /admin/users', // mints an account
      'DELETE /admin/users/:id', // destroys one
      'PUT /admin/users/:id/platform-role', // hands out the reserve itself
      'POST /admin/users/:id/regenerate-temp-password', // mints a credential
      'POST /admin/users/:id/send-password-reset', // takes over an account's login
      'DELETE /admin/organizations/:id', // irreversible
      'POST /admin/backups/restore', // overwrites the database
      'POST /admin/global-persons/:id/anonymise', // irreversible erasure
    ];
    for (const key of reserved) {
      expect(EXPECTED.get(key), key).toBe('super_admin');
    }
  });

  it('keeps the league-editor dropdown readable without the platform guard', () => {
    // A deliberate hole: org and league admins are not platform staff, but they
    // must list scoring systems to pick one. Guarding these would break the
    // league editor for every organiser.
    const keys = routes.map((r) => r.key);
    expect(keys).not.toContain('GET /admin/league-scoring-systems');
    expect(keys).not.toContain('GET /admin/league-scoring-systems/:id/versions');
  });

  it('only ever pins a tier that exists', () => {
    for (const [key, tier] of EXPECTED) {
      expect(PLATFORM_ROLES, key).toContain(tier);
    }
  });
});
