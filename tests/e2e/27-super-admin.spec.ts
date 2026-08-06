import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_bracket';

/**
 * The platform console: who is refused, and what it does when it is not.
 *
 * 42 pages under `apps/web-admin/app/admin` and ~30 `SuperAdminGuard`
 * controllers had no coverage at all. `13-privacy` proves an org owner is
 * refused on three destructive privacy routes; nothing had ever asked whether
 * the guard is wired on the rest, nor whether a single console action works.
 *
 * Two halves, and they need DIFFERENT accounts — which is the whole reason this
 * spec is shaped the way it is:
 *
 *   - **Half A** runs as the ordinary E2E organizer and asserts every guarded
 *     route refuses. It must NOT be a super admin, and asserts that first.
 *   - **Half B** runs as a dedicated platform account in its own browser
 *     context, because `playwright.e2e.config.ts` applies the organizer's
 *     `storageState` to every context — the pattern `18-staff-pad` uses.
 *
 * **Do not promote the organizer account to super admin to save a login.**
 * `13-privacy` carries a safety interlock that refuses to invoke retention and
 * anonymisation for real when `isSuperAdmin` is true, so promoting the shared
 * account silently drops that coverage and makes its 403 assertions vacuous.
 *
 * Out of scope, deliberately, and for the same reason `13-privacy` leaves them:
 * retention runs, person anonymisation, backups, org deletion, and HEMA Ratings
 * submission. Every one is destructive well beyond a throwaway event.
 *
 * AI keys and budgets used to be on that list as "handles real secrets".
 * `30-ai-settings` now covers them, on the footing that made it safe: it never
 * reads a secret back (there is no route that returns one), it creates its own
 * fake key rather than touching the operator's, and it snapshots and restores
 * the active key around everything it does.
 */

const SUPER_ADMIN = ['1', 'true', 'yes'].includes(
  (process.env.E2E_SUPER_ADMIN ?? '').toLowerCase(),
);
const SUPER_EMAIL = process.env.E2E_SUPERADMIN_EMAIL ?? '';
const SUPER_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD ?? '';

/**
 * One route per `SuperAdminGuard` controller — and the method matters, because
 * the guard is not always on the class. A GET is enough wherever the controller
 * guards itself wholesale; where it guards per method, the probe has to be one
 * of the methods that is actually guarded (see league-scoring-systems below).
 *
 * The assertion is **403 specifically**, never "some 4xx": a 404 would mean the
 * route is missing, which is a different bug wearing the same colour, and a
 * sweep that accepted it would go green the day a controller is renamed.
 *
 * Privacy's three admin routes are deliberately absent — `13-privacy` owns
 * those, and two owners for one assertion is how one of them rots unnoticed.
 *
 * **Adding an admin controller means adding a row here.** That is the point of
 * the sweep: the failure it exists to catch is a new controller that forgot
 * `@UseGuards(SuperAdminGuard)`, and it can only catch what it names.
 */
const GUARDED_ROUTES = [
  { method: 'GET', path: 'admin/ai-keys' },
  { method: 'GET', path: 'admin/ai-settings' },
  { method: 'GET', path: 'admin/ai-usage/summary' },
  { method: 'GET', path: 'admin/audit-log' },
  { method: 'GET', path: 'admin/backups/status' },
  { method: 'GET', path: 'admin/custom-rulesets' },
  { method: 'GET', path: 'admin/dashboard-stats' },
  { method: 'GET', path: 'admin/data-quality/scans' },
  { method: 'GET', path: 'admin/exchange-edit-requests' },
  { method: 'GET', path: 'admin/feature-flags' },
  { method: 'GET', path: 'admin/global-person-claim-requests' },
  { method: 'GET', path: 'admin/hema-ratings/health' },
  { method: 'GET', path: 'admin/notifications/summary' },
  { method: 'GET', path: 'admin/organizations' },
  { method: 'GET', path: 'admin/platform-log' },
  { method: 'GET', path: 'admin/review-queue' },
  { method: 'GET', path: 'admin/system-versions' },
  { method: 'GET', path: 'admin/system/runtime-health' },
  { method: 'GET', path: 'admin/system/tls-status' },
  { method: 'GET', path: 'admin/users' },
  { method: 'GET', path: 'admin/weapons' },
  // The one controller that guards per METHOD rather than per class: its two
  // GETs are open ON PURPOSE, because an org admin picks a scoring system when
  // creating a league, while every mutation carries the guard. Probing its list
  // would assert the opposite of the truth — so probe a write.
  //
  // The body is deliberately empty and therefore invalid. If the guard ever
  // disappeared, validation would answer 400 and this assertion would fail
  // loudly, without a row being created — the same reasoning that keeps
  // `13-privacy`'s anonymise probe pointed at an id that belongs to nobody.
  { method: 'POST', path: 'admin/league-scoring-systems' },
] as const;

/**
 * What the console must be able to READ as a super admin. Every guarded GET,
 * plus the league-scoring-systems list — open to org admins by design, but still
 * part of what the console shows.
 */
const CONSOLE_READS: readonly string[] = [
  ...GUARDED_ROUTES.filter((route) => route.method === 'GET').map((route) => route.path),
  'admin/league-scoring-systems',
];

/**
 * The flag Half B writes back to its own value.
 *
 * Every key in `@myclash/feature-flags` is behavioural, so the choice is about
 * blast radius rather than convenience: if the write path ever misbehaved,
 * `disable_hema_sync` pauses an external sync, while `admin_lockdown` or
 * `read_only_mode` would take the platform out from under a live event. The
 * value is read first, written back unchanged, and re-read to prove it did not
 * move — an inert write that still exercises the real write path and the audit
 * row it must leave behind.
 */
const WRITE_BACK_FLAG = 'disable_hema_sync';

interface MeResponse {
  user: { id: string; email: string };
  admin: { isSuperAdmin: boolean };
}

interface RegistryFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  payloadJson: Record<string, unknown> | null;
}

const me = async (api: Api) => api.json<MeResponse>(await api.get('me'));

test.describe('super admin', () => {
  test.skip(
    !SUPER_ADMIN,
    'set E2E_SUPER_ADMIN=1 to sweep the platform guard and drive the console',
  );

  test('every platform route refuses an org owner', async ({ request }) => {
    test.setTimeout(120_000);
    const api = apiFor(request);

    // A safety interlock, and the premise of the whole half: these assertions
    // mean nothing if the account being refused could in fact pass.
    const identity = await me(api);
    expect(
      identity.admin.isSuperAdmin,
      'the shared E2E account must NOT be a super admin — see the header note on 13-privacy',
    ).toBe(false);

    for (const route of GUARDED_ROUTES) {
      const response =
        route.method === 'GET'
          ? await api.get(route.path)
          : await api.post(route.path, { data: {} });
      expect(
        response.status(),
        `${route.method} ${route.path} must be super-admin only (403). A 404 means the route moved; ` +
          `a 200 or 400 means the guard is missing and only the router or validation stopped it.`,
      ).toBe(403);
    }
  });

  test('the console, driven as a super admin', async ({ browser }) => {
    test.skip(
      !SUPER_EMAIL || !SUPER_PASSWORD,
      'set E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD (a platform_roles row is required)',
    );
    test.setTimeout(180_000);
    const { baseURL } = runContext();

    // Its own cookie jar: the config applies the organizer's storageState to
    // every context, and the organizer branch would win.
    const platform = await browser.newContext({
      baseURL,
      storageState: undefined,
      ignoreHTTPSErrors: true,
    });

    try {
      const api = apiFor(platform.request);
      await api.ok(
        await api.post('auth/password-login', {
          data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
        }),
      );

      // Loud, and first. Every assertion below would otherwise pass vacuously
      // against a 403 if the platform_roles row were missing.
      const identity = await me(api);
      expect(
        identity.admin.isSuperAdmin,
        `${SUPER_EMAIL} is not a super admin — it needs a platform_roles row with role='super_admin'`,
      ).toBe(true);

      // ── The console reads ────────────────────────────────────────────────
      for (const path of CONSOLE_READS) {
        const response = await api.get(path);
        expect(response.status(), `${path} must answer a super admin`).toBe(200);
      }

      // ── One write, and the row it must leave in the audit log ────────────
      const flags = await api.json<RegistryFlag[]>(await api.get('admin/feature-flags'));
      const target = flags.find((f) => f.key === WRITE_BACK_FLAG);
      expect(target, `${WRITE_BACK_FLAG} must exist in the registry`).toBeTruthy();

      const upsert = await api.put(`admin/feature-flags/${WRITE_BACK_FLAG}`, {
        // `description` is `.optional()`, not `.nullable()`, so a null would be
        // rejected outright — omit it when the row carries none.
        data: {
          enabled: target!.enabled,
          ...(target!.description ? { description: target!.description } : {}),
        },
      });
      expect(upsert.status(), 'upsert answers 204 No Content').toBe(204);

      const after = await api.json<RegistryFlag[]>(await api.get('admin/feature-flags'));
      expect(
        after.find((f) => f.key === WRITE_BACK_FLAG)?.enabled,
        'the write-back must not have moved the flag',
      ).toBe(target!.enabled);

      // The tie-together. `audit_log` has a single writer and masking happens at
      // write time, so an action that succeeds but records nothing is invisible
      // to every unit test. Asserted on the ACTOR: the row has to carry the
      // account that made the change, not merely exist.
      const csv = await (await api.ok(await api.get('admin/audit-log/export.csv'))).text();
      const [header, ...rows] = csv.trim().split('\n');
      expect(header, 'the export contract is a fixed header').toBe(
        'created_at,actor_user_id,action,entity_type,entity_id,payload_json',
      );
      // All three together, on ONE row. "Some row mentions this actor" would pass
      // on any unrelated action the account had ever taken — an assertion that
      // goes green without proving the write above was recorded at all.
      expect(
        rows.some(
          (row) =>
            row.includes(identity.user.id) &&
            row.includes('feature_flag.upsert') &&
            row.includes(WRITE_BACK_FLAG),
        ),
        `the write must appear as feature_flag.upsert on ${WRITE_BACK_FLAG}, attributed to the super admin who made it`,
      ).toBe(true);
    } finally {
      await platform.close();
    }
  });
});
