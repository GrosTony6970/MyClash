import { test, expect } from '@playwright/test';
import { apiFor } from './_api';
import { runContext } from './_context';
import { installKey, liveAiConfig, orgKeysPath, type InstalledKey, type LiveAiConfig } from './_ai';

/**
 * The organiser AI tools that DO something, as opposed to the ones that write
 * prose: apply a proposed setup, confirm an action the chatbot suggested, and
 * ask a question about real tournament data.
 *
 * `31-ai-generation` covers the generated-content family. Everything here was
 * uncovered, and two of the three had never worked in production:
 *
 *   - **apply** was untestable, because no draft could reach `ready` — the
 *     model fenced its JSON and the service did a bare `JSON.parse`, so every
 *     draft died at `failed`. Fixed alongside this spec.
 *   - **the NL tournament query** 400'd on every request, because its hourly
 *     rate limit counted rows with a PostgREST server-side aggregate and
 *     aggregates are disabled. Fixed in `f7f73b88`; this is the first thing to
 *     assert it answers at all.
 *   - **chat proposal confirm/reject** simply had no coverage.
 *
 * Like `31`, this spends real money and is gated behind the same flags.
 *
 * ## The one place this spec deliberately steers the model
 *
 * The apply test does NOT apply whatever the model happened to propose. It
 * creates a real AI draft, then PATCHes `proposedActions` to a deterministic
 * action before applying. That is not a workaround — it is the product's actual
 * flow ("organizers review or edit drafts before applying"), and it is the only
 * way the *apply* path can be asserted rather than the model's phrasing. The
 * AI half is still exercised: the draft has to parse and validate first.
 */

const AI = ['1', 'true', 'yes'].includes((process.env.E2E_AI ?? '').toLowerCase());
const live: LiveAiConfig | null = AI ? liveAiConfig() : null;

const label = (what: string) => `E2E live ${what} — ${new Date().toISOString().slice(0, 19)}`;
const uniq = () => Date.now().toString(36);

interface Draft {
  id: string;
  draftType: string;
  status: string;
  summary: string | null;
  proposedActions: Record<string, unknown>[];
  validationState: { ok: boolean; errors?: string[] };
  error: string | null;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  toolCalls: { name: string }[];
  proposal: { id: string; status: string; draftType: string } | null;
}

interface Conversation {
  id: string;
  title: string | null;
  messages: ChatMessage[];
}

test.describe('AI organiser tools', () => {
  test.skip(!AI, 'set E2E_AI=1 to run the AI specs');
  test.skip(
    !live,
    'set E2E_AI_PROVIDER + E2E_AI_KEY to let the AI specs call a real provider ' +
      '(this is the only flag combination in the suite that spends money)',
  );

  // Per-test, for the reason `31` documents: a `beforeAll` install cannot be
  // undone, because Playwright refuses to let its `request` fixture reach the
  // teardown that would undo it.
  let orgKey: InstalledKey | null = null;

  test.beforeEach(async ({ request }) => {
    const { orgId } = runContext();
    orgKey = await installKey(apiFor(request), orgKeysPath(orgId), {
      label: label('org key'),
      provider: live!.provider,
      apiKey: live!.apiKey,
      model: live!.model,
      monthlyBudgetEur: live!.budgetEur,
    });
  });

  test.afterEach(async () => {
    await orgKey?.restore();
    orgKey = null;
  });

  test('setup assistant: a reviewed draft applies, and creates the real tournament', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { eventId } = runContext();

    // ── The AI half: a draft that actually parses and validates ─────────────
    const draft = await api.json<Draft>(
      await api.post(`events/${eventId}/ai-assistant/drafts`, {
        data: {
          draftType: 'tournament_config',
          prompt: 'A one-day longsword tournament for 16 fighters.',
        },
      }),
    );
    expect(draft.status, `the draft must parse (error: ${draft.error ?? 'none'})`).not.toBe(
      'failed',
    );
    expect(draft.proposedActions.length).toBeGreaterThan(0);

    // ── The organiser half: review and edit before applying ─────────────────
    //
    // Pinned to a known name/slug so the assertion below can find exactly this
    // tournament. The model's own slug is unpredictable and could collide with
    // a previous run in the shared event.
    const slug = `e2e-applied-${uniq()}`;
    const name = `E2E Applied Cup ${slug.slice(-6)}`;
    const reviewed = await api.json<Draft>(
      await api.patch(`events/${eventId}/ai-assistant/drafts/${draft.id}`, {
        data: {
          proposedActions: [
            { kind: 'create_tournament', name, slug, weapon: 'Longsword', rulesetCode: 'TF_v1' },
          ],
        },
      }),
    );
    expect(reviewed.status, 'an edited, valid draft becomes ready').toBe('ready');
    expect(reviewed.validationState.ok).toBe(true);

    // ── Apply, and prove it reached the real writers ────────────────────────
    const applied = await api.json<{ status?: string }>(
      await api.post(`events/${eventId}/ai-assistant/drafts/${draft.id}/apply`),
    );
    expect(applied.status ?? 'applied').toBe('applied');

    // The assertion that matters: a tournament exists in the event because the
    // draft was applied. `applyDraft` routes through EventsService.createTournament
    // rather than writing its own rows, so this also proves the dispatch.
    const tournaments = await api.json<{ id: string; name: string; slug: string }[]>(
      await api.get(`events/${eventId}/tournaments`),
    );
    const created = tournaments.find((t) => t.slug === slug);
    expect(created, `apply must have created the tournament "${slug}"`).toBeTruthy();
    expect(created!.name).toBe(name);

    // Applying twice must not duplicate it — the draft is spent.
    const again = await api.post(`events/${eventId}/ai-assistant/drafts/${draft.id}/apply`);
    expect(again.status(), 'an applied draft is no longer ready').toBe(400);
  });

  test('organiser chat: a proposed action is confirmed, and another is dismissed', async ({
    request,
  }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const { eventId } = runContext();

    const conversation = await api.json<Conversation>(
      await api.post(`events/${eventId}/chat/conversations`, { data: { title: 'E2E proposals' } }),
    );

    try {
      // ── Ask for a write. The chatbot must PROPOSE, never execute ──────────
      const rejectSlug = `e2e-chat-reject-${uniq()}`;
      const first = await api.json<Conversation>(
        await api.post(`events/${eventId}/chat/conversations/${conversation.id}/messages`, {
          data: {
            content:
              `Create a tournament named "E2E Chat Reject" with slug "${rejectSlug}", ` +
              'weapon Longsword. Propose it now.',
          },
        }),
      );

      const proposed = first.messages.find((m) => m.proposal)?.proposal ?? null;
      expect(
        proposed,
        'the chatbot must PROPOSE a write rather than answer in prose. If this is null the model ' +
          'did not call the write tool — the cheap default model is not flagged ' +
          'recommendedForToolUse, so try pinning E2E_AI_MODEL to a stronger one.',
      ).toBeTruthy();

      // Nothing may exist yet: proposing is not doing.
      const beforeConfirm = await api.json<{ slug: string }[]>(
        await api.get(`events/${eventId}/tournaments`),
      );
      expect(
        beforeConfirm.some((t) => t.slug === rejectSlug),
        'a proposal must not have written anything before the organiser confirms',
      ).toBe(false);

      // ── Dismiss it ────────────────────────────────────────────────────────
      await api.ok(
        await api.post(
          `events/${eventId}/chat/conversations/${conversation.id}/proposals/${proposed!.id}/reject`,
        ),
      );
      const afterReject = await api.json<Draft>(
        await api.get(`events/${eventId}/ai-assistant/drafts/${proposed!.id}`),
      );
      expect(afterReject.status, 'dismissing marks the underlying draft rejected').toBe('rejected');
      const stillAbsent = await api.json<{ slug: string }[]>(
        await api.get(`events/${eventId}/tournaments`),
      );
      expect(
        stillAbsent.some((t) => t.slug === rejectSlug),
        'a dismissed proposal must never reach the database',
      ).toBe(false);

      // ── Now one we confirm ────────────────────────────────────────────────
      const confirmSlug = `e2e-chat-ok-${uniq()}`;
      const second = await api.json<Conversation>(
        await api.post(`events/${eventId}/chat/conversations/${conversation.id}/messages`, {
          data: {
            content:
              `Now create a tournament named "E2E Chat Confirm" with slug "${confirmSlug}", ` +
              'weapon Longsword. Propose it now.',
          },
        }),
      );
      const second_proposal =
        second.messages.filter((m) => m.proposal && m.proposal.id !== proposed!.id).pop()
          ?.proposal ?? null;
      expect(second_proposal, 'the chatbot must propose the second action too').toBeTruthy();

      await api.ok(
        await api.post(
          `events/${eventId}/chat/conversations/${conversation.id}/proposals/${second_proposal!.id}/confirm`,
        ),
      );

      const afterConfirm = await api.json<{ slug: string; name: string }[]>(
        await api.get(`events/${eventId}/tournaments`),
      );
      expect(
        afterConfirm.some((t) => t.slug === confirmSlug),
        'confirming must apply the proposal for real',
      ).toBe(true);
    } finally {
      await api.delete(`events/${eventId}/chat/conversations/${conversation.id}`);
    }
  });

  test('natural-language query: settings, estimate, answer, history', async ({ request }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const { eventId } = runContext();

    // Needs a tournament with real data to be asked about. Reuses whatever the
    // shared event already has rather than playing another one — the query
    // tools read views, so any populated tournament will do.
    const tournaments = await api.json<{ id: string; name: string }[]>(
      await api.get(`events/${eventId}/tournaments`),
    );
    const tournament = tournaments[0];
    expect(tournament, 'the NL query needs a tournament in the shared event').toBeTruthy();
    const base = `tournaments/${tournament!.id}/query`;

    // ── Settings round-trip ────────────────────────────────────────────────
    const settings = await api.json<{ accessPolicy: string; rateLimitPerHour: number }>(
      await api.get(`${base}/settings`),
    );
    expect(settings.accessPolicy, 'the default policy is the most restrictive one').toBe(
      'organizers_only',
    );

    const widened = await api.json<{ accessPolicy: string }>(
      await api.patch(`${base}/settings`, { data: { accessPolicy: 'organizers_head_judges' } }),
    );
    expect(widened.accessPolicy).toBe('organizers_head_judges');
    // Restore: this is a live per-tournament access policy.
    await api.ok(
      await api.patch(`${base}/settings`, { data: { accessPolicy: settings.accessPolicy } }),
    );

    // ── Estimate is free and must precede the spend ────────────────────────
    const estimate = await api.json<{
      estimatedCostEur: number;
      allowed: boolean;
      cap: number | null;
    }>(
      await api.post(`${base}/estimate`, { data: { question: 'How many fighters are entered?' } }),
    );
    expect(estimate.estimatedCostEur).toBeGreaterThan(0);
    expect(estimate.allowed, 'no event cap is set, so the query must be allowed').toBe(true);

    // ── The real question ──────────────────────────────────────────────────
    //
    // This is the assertion the whole feature rested on and nothing checked:
    // until f7f73b88 the hourly rate limit counted rows with a PostgREST
    // aggregate, which is rejected, and `assertRateLimit` surfaced that as a
    // 400 — so every question failed before reaching a model.
    const answer = await api.json<{
      kind: string;
      language: string;
      toolCalled?: string;
      summary?: string;
      message?: string;
      costEur: number;
    }>(await api.post(base, { data: { question: 'How many fighters are entered?' } }));

    expect(
      answer.kind,
      `the query must resolve to an answer, not a refusal (${answer.message ?? ''})`,
    ).not.toBe('error');
    expect(answer.costEur, 'the query must be metered').toBeGreaterThan(0);
    // A grounded answer runs one of the whitelisted tools over the read-only
    // views. No tool means the model answered from the prompt alone, which is
    // exactly what this feature exists to avoid.
    expect(answer.toolCalled, 'the answer must come from a tool, not from the model').toBeTruthy();

    // ── History is per user, and records what was asked ────────────────────
    const history = await api.json<{ queries: { question: string; tool_name: string }[] }>(
      await api.get(`${base}/history`),
    );
    expect(
      history.queries.some((q) => q.question.includes('How many fighters')),
      'the question must appear in the asker’s own history',
    ).toBe(true);
  });

  test('the organiser AI pages render against a real event', async ({ page, request }) => {
    test.setTimeout(180_000);
    const api = apiFor(request);
    const { orgSlug, eventId } = runContext();

    // The setup assistant page: it gates its own form on whether the org has a
    // key, so with one installed the prompt box must be usable rather than
    // showing the "no key" notice.
    await page.goto(`/org/${orgSlug}/events/${eventId}/ai-assistant`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const promptBox = page.locator('textarea').first();
    await expect(promptBox, 'the draft prompt box must render').toBeVisible();
    await expect(promptBox, 'with a key installed the form must not be disabled').toBeEnabled();

    // The chatbot page.
    await page.goto(`/org/${orgSlug}/events/${eventId}/chat`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.locator('textarea, input[type="text"]').first(),
      'the chat composer must render',
    ).toBeVisible();

    // The NL query panel lives on the event overview and is gated on `aiEnabled`
    // — with a key installed it must be there.
    const tournaments = await api.json<{ id: string }[]>(
      await api.get(`events/${eventId}/tournaments`),
    );
    if (tournaments.length > 0) {
      await page.goto(`/org/${orgSlug}/events/${eventId}`);
      await expect(
        page.getByText(/ask|question|demander|question/i).first(),
        'the tournament query panel must render when AI is configured',
      ).toBeVisible({ timeout: 20_000 });
    }
  });
});
