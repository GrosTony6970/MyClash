# Super Admin Dashboard Implementation Plan

> **Status (2026-08-19):** Shipped — `/admin` carries the dashboard this plan specifies: `review-queue/` for community rulesets, `feature-flags/`, and organization approve/suspend, with the reactivation alias still labelled `T-1301` in `apps/api/src/modules/admin/organizations.controller.ts`. Historical record; do not execute.

**Goal:** Complete BUILD_ORDER `T-1301` by adding `/admin` dashboard coverage for organization approve/suspend, user disable, community ruleset approval, and feature flags.

**Architecture:** Extend the existing super-admin module instead of creating a separate platform service. Keep all privileged mutations behind `SuperAdminGuard`, write `audit_log` entries for every moderation action, and use Supabase service-role access only on the NestJS server. Add small platform tables for ruleset submissions and feature flags; do not execute community ruleset code.

**Tech Stack:** NestJS, Supabase JS admin API, Postgres migrations/RLS, Drizzle schema, Next.js admin app, Vitest.

---

## Context

- Next task is `T-1301 - Super admin dashboard` from `docs/BUILD_ORDER.md`.
- Existing `T-009c` already provides `apps/api/src/modules/admin/**` and `apps/web-admin/app/admin/organizations/**`.
- Architecture says self-signup has no approval gate; "approve org" for this task means super admin can set an organization back to `active` from `suspended` via an explicit approve/reactivate action.
- Community ruleset approval is metadata-only for v1: approve rows for built-in or admin-reviewed ruleset packages. Do not allow dynamic formulas, `eval`, or runtime code uploads.

## Files

- Modify `packages/db/migrations/0001_init.sql`: add platform tables.
- Modify `packages/db/migrations/0002_rls.sql`: add RLS for platform tables.
- Modify `packages/db/src/schema/auth.ts`: add Drizzle schema for platform tables.
- Modify `apps/api/src/modules/admin/admin.module.ts`: register new controllers/services.
- Modify `apps/api/src/modules/admin/organizations.controller.ts`: add approve alias if needed.
- Modify `apps/api/src/modules/admin/admin-organizations.service.ts`: expose `approveOrganization` as active status action.
- Create `apps/api/src/modules/admin/admin-users.service.ts`.
- Create `apps/api/src/modules/admin/users.controller.ts`.
- Create `apps/api/src/modules/admin/admin-rulesets.service.ts`.
- Create `apps/api/src/modules/admin/rulesets.controller.ts`.
- Create `apps/api/src/modules/admin/admin-feature-flags.service.ts`.
- Create `apps/api/src/modules/admin/feature-flags.controller.ts`.
- Create tests next to each new service in `apps/api/src/modules/admin/`.
- Create `apps/web-admin/app/admin/page.tsx`.
- Create `apps/web-admin/app/admin/users/page.tsx`.
- Create `apps/web-admin/app/admin/rulesets/page.tsx`.
- Create `apps/web-admin/app/admin/feature-flags/page.tsx`.
- Modify `apps/web-admin/app/admin/organizations/page.tsx`: label suspended-org active action as Approve/Reactivate.

## Task 1: Platform Tables

**Files:**

- Modify: `packages/db/migrations/0001_init.sql`
- Modify: `packages/db/migrations/0002_rls.sql`
- Modify: `packages/db/src/schema/auth.ts`

- [ ] Add `ruleset_submissions`:

```sql
CREATE TABLE IF NOT EXISTS ruleset_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  submitted_by_user_id UUID,
  package_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_user_id UUID,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ruleset_submissions_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT ruleset_submissions_code_version_unique UNIQUE (code, version)
);
```

- [ ] Add `feature_flags`:

```sql
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  payload_json JSONB,
  updated_by_user_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] Add indexes:

```sql
CREATE INDEX IF NOT EXISTS ruleset_submissions_status_idx ON ruleset_submissions (status);
CREATE INDEX IF NOT EXISTS feature_flags_enabled_idx ON feature_flags (enabled);
```

- [ ] Enable RLS and super-admin-only policies:

```sql
ALTER TABLE ruleset_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ruleset_submissions_super_admin_all" ON ruleset_submissions
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY "feature_flags_super_admin_all" ON feature_flags
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
```

- [ ] Add Drizzle exports in `auth.ts` with matching columns and status comment.
- [ ] Run: `pnpm --filter @myclash/db typecheck`
- [ ] Expected: PASS.

## Task 2: Organization Approve Alias

**Files:**

- Modify: `apps/api/src/modules/admin/admin-organizations.service.ts`
- Modify: `apps/api/src/modules/admin/organizations.controller.ts`
- Modify: `apps/api/src/modules/admin/admin-organizations.service.test.ts`

- [ ] Add service method:

```ts
async approveOrganization(id: string, actorUserId: string): Promise<void> {
  await this.updateStatus(id, 'active', actorUserId, 'org.approve');
}
```

- [ ] Add endpoint:

```ts
@Patch(':id/approve')
@HttpCode(HttpStatus.NO_CONTENT)
@ApiOperation({ summary: 'Approve/reactivate organization (super admin)' })
async approve(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
  await this.service.approveOrganization(id, getActorId(req));
}
```

- [ ] Add Vitest asserting status update to `active` and audit action `org.approve`.
- [ ] Run: `pnpm --filter @myclash/api test -- src/modules/admin/admin-organizations.service.test.ts`
- [ ] Expected: PASS.

## Task 3: User Disable API

**Files:**

- Create: `apps/api/src/modules/admin/admin-users.service.ts`
- Create: `apps/api/src/modules/admin/users.controller.ts`
- Create: `apps/api/src/modules/admin/admin-users.service.test.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts`

- [ ] Implement `AdminUsersService.listUsers()` with `this.supabase.service.auth.admin.listUsers({ page, perPage })`.
- [ ] Implement disable with Supabase admin API:

```ts
await this.supabase.service.auth.admin.updateUserById(userId, {
  ban_duration: '876000h',
});
```

- [ ] Implement enable:

```ts
await this.supabase.service.auth.admin.updateUserById(userId, {
  ban_duration: 'none',
});
```

- [ ] Write `audit_log` actions `user.disable` and `user.enable` with actor, entity type `user`, entity id `userId`.
- [ ] Add endpoints:

```ts
GET /api/v1/admin/users
PATCH /api/v1/admin/users/:id/disable
PATCH /api/v1/admin/users/:id/enable
```

- [ ] Tests:
  - list delegates to `auth.admin.listUsers`.
  - disable calls `updateUserById` with `ban_duration: '876000h'`.
  - enable calls `updateUserById` with `ban_duration: 'none'`.
  - failed Supabase admin call throws `BadRequestException`.
- [ ] Run: `pnpm --filter @myclash/api test -- src/modules/admin/admin-users.service.test.ts`
- [ ] Expected: PASS.

## Task 4: Ruleset Moderation API

**Files:**

- Create: `apps/api/src/modules/admin/admin-rulesets.service.ts`
- Create: `apps/api/src/modules/admin/rulesets.controller.ts`
- Create: `apps/api/src/modules/admin/dto/admin-rulesets.dto.ts`
- Create: `apps/api/src/modules/admin/admin-rulesets.service.test.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts`

- [ ] Implement list with optional status filter over `ruleset_submissions`.
- [ ] Implement approve:

```ts
update({
  status: 'approved',
  reviewed_by_user_id: actorUserId,
  reviewed_at: new Date().toISOString(),
  rejection_reason: null,
  updated_at: new Date().toISOString(),
});
```

- [ ] Implement reject with required non-empty `reason`, status `rejected`, and `rejection_reason`.
- [ ] Add endpoints:

```ts
GET /api/v1/admin/rulesets?status=pending
PATCH /api/v1/admin/rulesets/:id/approve
PATCH /api/v1/admin/rulesets/:id/reject
```

- [ ] Write audit actions `ruleset.approve` and `ruleset.reject`.
- [ ] Tests:
  - approve marks row approved and writes audit.
  - reject requires reason and marks row rejected.
  - service never imports or executes submitted code.
- [ ] Run: `pnpm --filter @myclash/api test -- src/modules/admin/admin-rulesets.service.test.ts`
- [ ] Expected: PASS.

## Task 5: Feature Flag API

**Files:**

- Create: `apps/api/src/modules/admin/admin-feature-flags.service.ts`
- Create: `apps/api/src/modules/admin/feature-flags.controller.ts`
- Create: `apps/api/src/modules/admin/dto/admin-feature-flags.dto.ts`
- Create: `apps/api/src/modules/admin/admin-feature-flags.service.test.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts`

- [ ] Implement list all flags ordered by `key`.
- [ ] Implement upsert:

```ts
upsert({
  key: dto.key,
  description: dto.description ?? null,
  enabled: dto.enabled,
  payload_json: dto.payload ?? null,
  updated_by_user_id: actorUserId,
  updated_at: new Date().toISOString(),
});
```

- [ ] Implement delete by key.
- [ ] Add endpoints:

```ts
GET /api/v1/admin/feature-flags
PUT /api/v1/admin/feature-flags/:key
DELETE /api/v1/admin/feature-flags/:key
```

- [ ] Write audit actions `feature_flag.upsert` and `feature_flag.delete`.
- [ ] Tests:
  - upsert stores key/enabled/payload and actor.
  - delete removes by key.
  - invalid empty key fails DTO validation.
- [ ] Run: `pnpm --filter @myclash/api test -- src/modules/admin/admin-feature-flags.service.test.ts`
- [ ] Expected: PASS.

## Task 6: Admin Dashboard UI

**Files:**

- Create: `apps/web-admin/app/admin/page.tsx`
- Modify: `apps/web-admin/app/admin/organizations/page.tsx`
- Create: `apps/web-admin/app/admin/users/page.tsx`
- Create: `apps/web-admin/app/admin/rulesets/page.tsx`
- Create: `apps/web-admin/app/admin/feature-flags/page.tsx`

- [ ] `/admin` shows compact tiles linking to Organizations, Users, Rulesets, Feature Flags, Audit Log placeholder.
- [ ] Organizations page calls `PATCH /approve` for suspended orgs and labels action `Approve`.
- [ ] Users page lists users with email, id, created date, and disabled state if returned by Supabase; actions call disable/enable.
- [ ] Rulesets page lists submissions with status filter and approve/reject controls. Reject uses `window.prompt()` for reason in this task.
- [ ] Feature flags page lists flags, lets super admin toggle enabled, edit JSON payload in a textarea, and delete a flag.
- [ ] Match current admin visual style: dense tables, small controls, red primary actions, no marketing layout.
- [ ] Run: `pnpm --filter @myclash/web-admin typecheck`
- [ ] Expected: PASS.

## Task 7: Full Verification

- [ ] Run focused API tests:

```powershell
pnpm --filter @myclash/api test -- src/modules/admin/admin-organizations.service.test.ts src/modules/admin/admin-users.service.test.ts src/modules/admin/admin-rulesets.service.test.ts src/modules/admin/admin-feature-flags.service.test.ts
```

- [ ] Run full local gates:

```powershell
pnpm turbo run typecheck
pnpm turbo run lint
pnpm test
```

- [ ] Expected: all PASS.
- [ ] Update `memory/MEMORY.md` Phase P13 with `T-1301` status after implementation commit.

## Acceptance Mapping

- Org approve/suspend: existing suspend plus new explicit approve alias and UI label.
- Disable a user: Supabase Auth admin ban/unban endpoints, audit logged.
- Approve a community-submitted ruleset: `ruleset_submissions` moderation API/UI, metadata-only, no dynamic execution.
- Feature flags: `feature_flags` admin API/UI.

## Assumptions

- No pending organization status is added because architecture explicitly says signup has no approval gate.
- User disable means banning Supabase auth user through server-side admin API; no new public app behavior is needed in this task.
- Community ruleset moderation does not make a submitted ruleset executable; runtime registration remains a separate code-review/deploy process.
- Feature flags are platform config only in this task; consuming flags in product code comes later when a feature needs them.
