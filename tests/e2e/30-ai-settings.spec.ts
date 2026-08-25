import { test, expect } from '@playwright/test';
import { apiFor, type Api } from './_api';
import { runContext } from './_context';
import {
  FAKE_KEY,
  PLATFORM_KEYS_PATH,
  getKeys,
  orgKeysPath,
  withOrgAiFlags,
  type AiKey,
  type ModelOption,
  type OrgAiConfig,
  type UsageRollup,
} from './_ai';

/**
 * The AI configuration surface: who may hold a provider key, what the API ever
 * gives back about it, and what happens when AI is switched off.
 *
 * Six API modules and four admin pages had zero E2E assertions. The only AI in
 * the whole suite was three `admin/ai-*` rows in 27-super-admin's guard sweep,
 * whose header rules AI keys and budgets OUT of scope as "handles real secrets".
 * That call was right for a sweep spec and wrong as a permanent state: the key
 * store is the one place in this codebase that encrypts a user secret, and
 * nothing checked that the secret stays in.
 *
 * This spec spends NOTHING. Key creation validates `apiKey` as
 * `z.string().min(10)` and never contacts the provider, so the whole store path
 * — AES-256-GCM round-trip, the one-active-key invariant, masking — runs on a
 * fake string. Real provider calls live in 31-ai-generation.
 *
 * Everything it touches is live org configuration, so every mutation is either
 * written back to the value it read (the 27-super-admin inert-write pattern) or
 * restored in a `finally`. A spec that leaves `aiFeaturesDisabled` set has
 * turned AI off for a real organizer.
 */

const AI = ['1', 'true', 'yes'].includes((process.env.E2E_AI ?? '').toLowerCase());
const SUPER_EMAIL = process.env.E2E_SUPERADMIN_EMAIL ?? '';
const SUPER_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD ?? '';

/** Labels this spec creates, so a failed run is identifiable at a glance. */
const label = (what: string) => `E2E ${what} — ${new Date().toISOString().slice(0, 19)}`;

test.describe('AI settings', () => {
  test.skip(!AI, 'set E2E_AI=1 to run the AI specs');

  test('an org AI key: created, masked, activated, updated, deleted', async ({ request }) => {
    test.setTimeout(120_000);
    const api = apiFor(request);
    const { orgId } = runContext();
    const scope = orgKeysPath(orgId);

    const before = await getKeys(api, scope);
    const previouslyActive = before.find((k) => k.isActive) ?? null;
    const created: string[] = [];

    try {
      // ── A key round-trips, and the secret does not come back ──────────────
      const first = await api.json<AiKey>(
        await api.post(scope, {
          data: {
            label: label('key A'),
            provider: 'mistral',
            model: 'open-mistral-7b',
            apiKey: FAKE_KEY,
            monthlyBudgetEur: 1,
            isActive: true,
          },
        }),
      );
      created.push(first.id);

      // The assertion this spec exists for. `key_last4` is the ONLY part of the
      // secret any read path may expose; the ciphertext and IV are columns on
      // the same row, so a `select('*')` slipping into the list query would leak
      // an encrypted-at-rest secret to every org admin. Checked on the raw body,
      // not the parsed object, because the failure is an EXTRA field.
      const listBody = await (await api.ok(await api.get(scope))).text();
      expect(listBody, 'the key list must never carry the API key').not.toContain(FAKE_KEY);
      expect(listBody, 'the key list must never carry the ciphertext').not.toMatch(
        /"(key_ciphertext|keyCiphertext|key_iv|keyIv|api_key|apiKey)"/,
      );
      expect(first.keyLast4, 'the last 4 chars are what the UI shows').toBe(FAKE_KEY.slice(-4));

      // ── One active key, enforced ─────────────────────────────────────────
      const second = await api.json<AiKey>(
        await api.post(scope, {
          data: {
            label: label('key B'),
            provider: 'mistral',
            model: 'mistral-small-4',
            apiKey: `${FAKE_KEY}-b`,
          },
        }),
      );
      created.push(second.id);

      await api.ok(await api.post(`${scope}/${second.id}/activate`));
      const afterActivate = await getKeys(api, scope);
      expect(
        afterActivate.filter((k) => k.isActive).map((k) => k.id),
        'activating B must deactivate A — the partial unique index allows exactly one',
      ).toEqual([second.id]);

      // ── The model is validated against the registry ──────────────────────
      const badModel = await api.patch(`${scope}/${second.id}`, {
        data: { model: 'gpt-4-that-was-never-in-the-registry' },
      });
      expect(
        badModel.status(),
        'an unknown model must be refused, not stored and discovered at generate time',
      ).toBe(400);

      // A valid update sticks, and omitting `apiKey` keeps the stored secret.
      const renamed = await api.json<AiKey>(
        await api.patch(`${scope}/${second.id}`, {
          data: { label: label('key B renamed'), monthlyBudgetEur: 2 },
        }),
      );
      expect(renamed.monthlyBudgetEur).toBe(2);
      expect(renamed.keyLast4, 'omitting apiKey must keep the stored key').toBe(
        `${FAKE_KEY}-b`.slice(-4),
      );
    } finally {
      for (const id of created) await api.delete(`${scope}/${id}`);
      if (previouslyActive) await api.post(`${scope}/${previouslyActive.id}/activate`);
    }

    // The scope is exactly as it was found. This is the assertion that catches
    // a restore bug in THIS spec — without it, a broken cleanup would only
    // surface as the operator's AI mysteriously stopping days later.
    const after = await getKeys(api, scope);
    expect(after.map((k) => k.id).sort()).toEqual(before.map((k) => k.id).sort());
    expect(after.find((k) => k.isActive)?.id ?? null).toBe(previouslyActive?.id ?? null);
  });

  test('budget and availability flags round-trip', async ({ request }) => {
    const api = apiFor(request);
    const { orgId } = runContext();

    const before = await api.json<OrgAiConfig | null>(
      await api.get(`organizations/${orgId}/ai-settings`),
    );

    // Written back to their own values: an inert write that still exercises the
    // real upsert path. Flipping a live org's AI budget for the duration of a
    // test run is not worth the marginally stronger assertion.
    const budget = await api.json<OrgAiConfig>(
      await api.patch(`organizations/${orgId}/ai-settings/budget`, {
        data: { monthlyBudgetEur: before?.monthlyBudgetEur ?? null },
      }),
    );
    expect(budget.monthlyBudgetEur).toBe(before?.monthlyBudgetEur ?? null);

    const flags = await api.json<OrgAiConfig>(
      await api.patch(`organizations/${orgId}/ai-settings/flags`, {
        data: {
          aiFeaturesDisabled: before?.aiFeaturesDisabled ?? false,
          organizerChatDisabled: before?.organizerChatDisabled ?? false,
        },
      }),
    );
    expect(flags.aiFeaturesDisabled).toBe(before?.aiFeaturesDisabled ?? false);
    expect(flags.organizerChatDisabled).toBe(before?.organizerChatDisabled ?? false);

    // `hasKey` is computed from whether an ACTIVE key exists, not from the
    // settings row — the two live in different tables and drifted apart once.
    const keys = await getKeys(api, orgKeysPath(orgId));
    expect(flags.hasKey, 'hasKey must track the active key, not the settings row').toBe(
      keys.some((k) => k.isActive),
    );

    const rollup = await api.json<UsageRollup>(
      await api.get(`organizations/${orgId}/ai-usage/summary`),
    );
    expect(typeof rollup.total.costEur, 'the consumption dashboard must answer').toBe('number');
  });

  test('with AI switched off, generation is refused before any provider call', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const api = apiFor(request);
    const { orgId, eventId } = runContext();

    // The org kill-switch. 503 SPECIFICALLY, not "some error": a 404 would mean
    // the route moved and a 400 would mean validation stopped it first — either
    // would pass a looser assertion while the switch itself did nothing.
    //
    // The STATUS is the whole assertion, and deliberately so. The service throws
    // `ServiceUnavailableException('AI features are disabled for this
    // organization')`, but `api-exception.filter.ts` replaces the message of
    // EVERY response with a status >= 500 with a flat "Internal server error"
    // (normalizeException, the `statusCode >= 500` branch). That scrubbing is
    // right for real crashes and wrong for a 503 the product throws on purpose —
    // an organizer who switched AI off is told the server broke. Asserting the
    // message here would just fail; see the note in the README.
    await withOrgAiFlags(api, orgId, { aiFeaturesDisabled: true }, async () => {
      const res = await api.post(`generated-content/organizer_content/${eventId}/generate`);
      expect(
        res.status(),
        'org AI disabled must refuse with 503 before the provider is contacted',
      ).toBe(503);
    });

    // The chatbot switch is narrower: it stops chat and leaves everything else
    // alone. Asserting only that chat 503s would pass even if the flag had
    // taken all of AI down with it, so both halves are checked together.
    await withOrgAiFlags(api, orgId, { organizerChatDisabled: true }, async () => {
      const conversation = await api.post(`events/${eventId}/chat/conversations`, { data: {} });
      const conversationId = conversation.ok()
        ? ((await conversation.json()) as { id: string }).id
        : null;
      expect(
        conversationId,
        'creating a conversation is not gated by the chat switch',
      ).toBeTruthy();

      const send = await api.post(
        `events/${eventId}/chat/conversations/${conversationId}/messages`,
        { data: { content: 'Is the chatbot switched off?' } },
      );
      expect(send.status(), 'organizerChatDisabled must refuse the assistant turn').toBe(503);

      await api.delete(`events/${eventId}/chat/conversations/${conversationId}`);
    });
  });

  test('with no active key, every AI entry point says so', async ({ request }) => {
    test.setTimeout(120_000);
    const api = apiFor(request);
    const { orgId, eventId } = runContext();
    const scope = orgKeysPath(orgId);

    const before = await getKeys(api, scope);
    const previouslyActive = before.find((k) => k.isActive) ?? null;
    if (!previouslyActive) {
      // Nothing to deactivate: the org has no key, which is already the state
      // under test. Fall through to the assertions.
      await assertNoKeyRefusals(api, eventId);
      return;
    }

    // There is no "deactivate" route — the invariant is one-active-or-none, and
    // only delete clears it. So this branch runs by temporarily removing the
    // key and re-creating it, which is NOT acceptable against a real secret we
    // cannot read back. Skip instead, and say why.
    test.skip(
      true,
      'the org holds an active key; proving the no-key refusal would require deleting a secret ' +
        'this spec cannot restore (the plaintext is write-only). Run against an org with no key.',
    );
  });

  test('the settings page renders what the API returns', async ({ page, request }) => {
    const api = apiFor(request);
    const { orgSlug } = runContext();

    // The picker's catalogue. Unauthenticated by design (labels only, no
    // pricing), and the key form is unusable without it.
    const models = await api.json<Record<string, ModelOption[]>>(await api.get('ai/models'));
    expect(Object.keys(models).sort(), 'every provider must offer models').toEqual([
      'anthropic',
      'google',
      'mistral',
      'openai',
    ]);

    await page.goto(`/org/${orgSlug}/settings/ai`);
    // The three sections the page is made of. Asserted by their headings rather
    // than by a key row: an org with no key still renders all three, and a test
    // that needed a key present would be asserting the operator's config.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const body = page.locator('main');
    await expect(body).toContainText(/budget/i);
    await expect(body).toContainText(/usage|consumption|consommation/i);
  });

  test('the platform AI console, driven as a super admin', async ({ browser }) => {
    test.skip(
      !SUPER_EMAIL || !SUPER_PASSWORD,
      'set E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD (a platform_roles row is required)',
    );
    test.setTimeout(180_000);
    const { baseURL } = runContext();

    // Its own cookie jar: playwright.e2e.config.ts applies the organizer's
    // storageState to every context, and the organizer would be refused.
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
      // `/me` reports a TIER, not a boolean: the platform guard grew
      // super_admin / platform_admin / platform_viewer, and `isSuperAdmin` went
      // away with it. Asserted on the exact tier rather than "any role",
      // because AI keys are reserved to super_admin — a platform_admin passing
      // here would mean the reservation had quietly widened.
      const identity = await api.json<{ admin: { platformRole: string | null } }>(
        await api.get('me'),
      );
      expect(
        identity.admin.platformRole,
        `${SUPER_EMAIL} is not a super admin — it needs a platform_roles row with role='super_admin'`,
      ).toBe('super_admin');

      for (const path of ['admin/ai-keys', 'admin/ai-settings', 'admin/ai-usage/summary']) {
        expect((await api.get(path)).status(), `${path} must answer a super admin`).toBe(200);
      }

      // The platform key scope is the same store behind a different path, so it
      // gets the same masking assertion. Created WITHOUT `isActive`, so that an
      // operator who already has a real platform key keeps it serving — a fake
      // one seizing the scope would break the data-quality scan below for as
      // long as the test held it.
      const platformBefore = await getKeys(api, PLATFORM_KEYS_PATH);
      const platformKey = await api.json<AiKey>(
        await api.post(PLATFORM_KEYS_PATH, {
          data: {
            label: label('platform key'),
            provider: 'mistral',
            model: 'open-mistral-7b',
            apiKey: FAKE_KEY,
          },
        }),
      );
      try {
        const body = await (await api.ok(await api.get(PLATFORM_KEYS_PATH))).text();
        expect(body, 'the platform key list must never carry the API key').not.toContain(FAKE_KEY);

        // `AiKeyStore.create` activates when `isActive` is asked for OR the
        // scope is empty — a first key with nothing to serve would otherwise be
        // dead on arrival. So the invariant is conditional, and asserting a
        // flat `false` would fail on any platform that has no key yet.
        expect(
          platformKey.isActive,
          platformBefore.length === 0
            ? 'the first key in an empty scope must activate itself'
            : 'a key created without isActive must not displace the one already serving',
        ).toBe(platformBefore.length === 0);
      } finally {
        await api.delete(`${PLATFORM_KEYS_PATH}/${platformKey.id}`);
        // Deleting the active key makes the store promote another; put the
        // operator's own key back in charge if there was one.
        const wasActive = platformBefore.find((k) => k.isActive);
        if (wasActive) await api.post(`${PLATFORM_KEYS_PATH}/${wasActive.id}/activate`);
      }

      // ── Data quality: the scan → findings → dismiss lifecycle ────────────
      //
      // `mode: 'deterministic'` on purpose. The default 'ai' mode scans the
      // ENTIRE real platform (every global_person, club and referee) through an
      // LLM at unbounded cost and writes findings about real people on every
      // run. The controller ships this mode as the zero-cost path and it
      // exercises the same scan → findings → review pipeline.
      // Note the shape: the deterministic path answers `{ scanId, ... }` while
      // `listScans` returns raw rows keyed `id`. The two are not the same name
      // for the same thing, and reading `id` off the POST silently yields
      // undefined — which is exactly how this assertion first went green-ish.
      const scan = await api.json<{
        scanId: string;
        candidateCount: number;
        findingCount: number;
      }>(await api.post('admin/data-quality/scans', { data: { mode: 'deterministic' } }));
      expect(scan.scanId, 'a scan must be recorded').toBeTruthy();
      expect(typeof scan.candidateCount, 'the rule finders must report what they looked at').toBe(
        'number',
      );

      const scans = await api.json<{ id: string }[]>(await api.get('admin/data-quality/scans'));
      expect(
        scans.some((s) => s.id === scan.scanId),
        'the scan just run must appear in the history',
      ).toBe(true);

      const findings = await api.json<{ id: string; status: string }[]>(
        await api.get('admin/data-quality/findings?status=open'),
      );
      // Findings are real platform data: there may legitimately be none. Only
      // exercise the review write when the queue has something in it, and
      // restore it — dismissing a real finding hides a real duplicate.
      const target = findings[0];
      if (target) {
        const dismissed = await api.json<{ status: string }>(
          await api.patch(`admin/data-quality/findings/${target.id}`, {
            data: { status: 'dismissed' },
          }),
        );
        expect(dismissed.status).toBe('dismissed');

        // The regression that made this worth an E2E: both row builders
        // hard-coded `status: 'open'` and the upsert conflicts on the
        // fingerprint, which is stable across scans — so a rescan reopened
        // every dismissal, and the 04:00 cron did it nightly. Rescan the
        // same data and the dismissal must still stand.
        await api.post('admin/data-quality/scans', { data: { mode: 'deterministic' } });
        const stillDismissed = await api.json<{ id: string }[]>(
          await api.get('admin/data-quality/findings?status=dismissed'),
        );
        expect(
          stillDismissed.some((f) => f.id === target.id),
          'a rescan must not undo the operator’s dismissal',
        ).toBe(true);

        await api.patch(`admin/data-quality/findings/${target.id}`, { data: { status: 'open' } });
      }
    } finally {
      await platform.close();
    }
  });
});

/** The three entry points that must all refuse identically when no key is active. */
async function assertNoKeyRefusals(api: Api, eventId: string): Promise<void> {
  const generate = await api.post(`generated-content/organizer_content/${eventId}/generate`);
  expect(generate.status(), 'no active key → 404 "No AI provider configured"').toBe(404);

  const draft = await api.post(`events/${eventId}/ai-assistant/drafts`, {
    data: { draftType: 'tournament_config', prompt: 'A five-fighter longsword pool.' },
  });
  expect(draft.status(), 'the setup assistant must refuse the same way').toBe(404);
}
