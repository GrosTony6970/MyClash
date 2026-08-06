import { test, expect } from '@playwright/test';
import { apiFor, type Api } from './_api';
import { runContext } from './_context';
import { playTournamentToChampion } from './_tournament';
import {
  FIGHTER_KEYS_PATH,
  installKey,
  liveAiConfig,
  orgKeysPath,
  type EventUsage,
  type GeneratedContent,
  type InstalledKey,
  type LiveAiConfig,
} from './_ai';

/**
 * The AI features doing the thing they exist to do: calling a real provider.
 *
 * **This spec spends real money.** It is the only one in the suite that does.
 * Every leg runs on the key in `E2E_AI_KEY`, pinned to the cheapest model in the
 * registry for that provider and capped by a per-key monthly budget, so a
 * runaway loop hits `BudgetExceededException` rather than billing on.
 *
 * ── What is and is not asserted ──────────────────────────────────────────────
 *
 * Model output is nondeterministic, so the prose itself is NOT asserted — not
 * its wording, not its length, and not that the champion's name appears in it.
 * A cheap model paraphrases, and an assertion that fails on paraphrasing tests
 * the model, not MyClash. What IS asserted is everything around the call:
 *
 *   - the facts pipeline had real data to narrate (checked against the same
 *     public standings endpoint `buildContext` reads);
 *   - a row landed in the usage log, so the call was METERED — an unmetered
 *     call is a budget that silently does nothing;
 *   - the content was stored as a draft, and publish/unpublish moves it in and
 *     out of the public projection;
 *   - `canPublish: false` types refuse to publish at all.
 *
 * ── The one prerequisite this spec cannot create ─────────────────────────────
 *
 * The fighter-insight leg needs `E2E_ADMIN_EMAIL` to have a CLAIMED
 * `global_persons` row. It cannot claim one for itself (claiming goes through a
 * super-admin-reviewed request), so it skips with the reason when the account
 * has no profile.
 */

const AI = ['1', 'true', 'yes'].includes((process.env.E2E_AI ?? '').toLowerCase());
const live: LiveAiConfig | null = AI ? liveAiConfig() : null;

const label = (what: string) => `E2E live ${what} — ${new Date().toISOString().slice(0, 19)}`;

/** `events/:eventId/ai-usage` — the meter every org-scoped call must move. */
const eventSpend = async (api: Api, eventId: string): Promise<EventUsage> =>
  api.json<EventUsage>(await api.get(`events/${eventId}/ai-usage`));

test.describe('AI generation', () => {
  test.skip(!AI, 'set E2E_AI=1 to run the AI specs');
  test.skip(
    !live,
    'set E2E_AI_PROVIDER + E2E_AI_KEY to let the AI specs call a real provider ' +
      '(this is the only flag combination in the suite that spends money)',
  );

  // One org key for every org-scoped leg, installed once and restored once.
  // `workers: 1` means no other spec can race the active-key flip.
  let orgKey: InstalledKey;

  test.beforeAll(async ({ request }) => {
    // Belt and braces: the describe-level skips above already stop the tests,
    // but a hook that ran anyway would install a key nothing then removes.
    if (!AI || !live) return;
    const api = apiFor(request);
    const { orgId } = runContext();
    orgKey = await installKey(api, orgKeysPath(orgId), {
      label: label('org key'),
      provider: live!.provider,
      apiKey: live!.apiKey,
      model: live!.model,
      monthlyBudgetEur: live!.budgetEur,
    });
  });

  test.afterAll(async () => {
    await orgKey?.restore();
  });

  test('organizer content: generated, metered, and never publishable', async ({ request }) => {
    test.setTimeout(180_000);
    const api = apiFor(request);
    const { eventId } = runContext();

    const before = await eventSpend(api, eventId);

    const draft = await api.json<GeneratedContent>(
      await api.post(`generated-content/organizer_content/${eventId}/generate`),
    );
    expect(draft.content.trim().length, 'the model must return something to store').toBeGreaterThan(
      0,
    );
    expect(draft.status, 'generated content starts as a private draft').toBe('draft');
    expect(draft.model, 'the resolved model is echoed back so usage can be attributed').toBe(
      live!.model,
    );

    // The meter. A generate that works but records nothing leaves every budget
    // and every spend ceiling in the product inert — and no unit test can see
    // it, because the insert is a side effect of a mocked provider call.
    const after = await eventSpend(api, eventId);
    expect(after.callCount, 'the call must be metered against the event').toBeGreaterThan(
      before.callCount,
    );
    expect(after.totalSpendEur, 'the call must carry a cost').toBeGreaterThan(before.totalSpendEur);

    // `canPublish = false`: this type is a draft the organizer edits, never a
    // public surface. The refusal is the whole contract.
    const publish = await api.post(`generated-content/organizer_content/${eventId}/publish`);
    expect(publish.status(), 'organizer_content must refuse to publish').toBe(400);

    // Re-reading returns the cached draft rather than generating again.
    const cached = await api.json<GeneratedContent>(
      await api.get(`generated-content/organizer_content/${eventId}`),
    );
    expect(cached.generatedAt, 'GET must serve the cache, not re-run the model').toBe(
      draft.generatedAt,
    );
  });

  test('tournament recap: grounded, published, then retracted', async ({ request }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const { eventId, eventSlug } = runContext();

    const slug = `e2e-recap-${Date.now().toString(36)}`;
    const finished = await playTournamentToChampion(api, eventId, {
      name: 'E2E Recap Cup',
      slug,
    });

    // The recap's facts come from the PUBLIC standings, which are gated on
    // tournament status — an unpublished tournament yields an empty podium and
    // a recap about nothing. Publishing the tournament (not the event) is
    // enough, and is silent: only event publish announces to followers.
    await api.ok(await api.post(`tournaments/${finished.id}/publish`));
    await api.ok(await api.patch(`tournaments/${finished.id}`, { data: { status: 'completed' } }));

    // Assert the facts pipeline has something real BEFORE spending on the call.
    // This is the grounding assertion: the same endpoint `buildContext` reads
    // must show a decided bracket, or the recap is prose over an empty object.
    const standings = await api.json<{ bracketSlots?: { status: string }[] }>(
      await api.get(`events/${eventSlug}/tournaments/${slug}/standings`),
    );
    expect(
      (standings.bracketSlots ?? []).filter((s) => s.status === 'completed').length,
      'the recap needs a decided bracket to narrate — publish the tournament first',
    ).toBeGreaterThan(0);

    const recap = await api.json<GeneratedContent>(
      await api.post(`generated-content/tournament_recap/${finished.id}/generate`),
    );
    expect(recap.content.trim().length).toBeGreaterThan(0);
    expect(recap.status).toBe('draft');

    const publicPath = `public/generated-content/tournament_recap/${finished.id}`;

    // Unauthenticated readers must not see a draft. This is the assertion that
    // matters most on this surface: the organizer's unreviewed AI copy going
    // live on the public site is the failure the draft/published split exists
    // to prevent.
    expect(
      await api.json<GeneratedContent | null>(await api.get(publicPath)),
      'a draft must be invisible publicly',
    ).toBeNull();

    await api.ok(await api.post(`generated-content/tournament_recap/${finished.id}/publish`));
    const published = await api.json<GeneratedContent>(await api.get(publicPath));
    expect(published?.content, 'publishing exposes the same content, unchanged').toBe(
      recap.content,
    );
    expect(published?.status).toBe('published');

    // The EN copy answers a French reader when no FR copy is published — a
    // reader should see the recap the organizer wrote, not a blank panel.
    const french = await api.json<GeneratedContent | null>(
      await api.get(`${publicPath}?locale=fr`),
    );
    expect(french?.content, 'an unpublished locale falls back to EN').toBe(recap.content);

    await api.ok(await api.post(`generated-content/tournament_recap/${finished.id}/unpublish`));
    expect(
      await api.json<GeneratedContent | null>(await api.get(publicPath)),
      'retracting must remove it from the public projection again',
    ).toBeNull();
  });

  test('organizer chat: a real assistant turn, persisted', async ({ request }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { eventId } = runContext();

    const conversation = await api.json<{ id: string; messages: unknown[] }>(
      await api.post(`events/${eventId}/chat/conversations`, { data: { title: 'E2E chat' } }),
    );

    try {
      const before = await eventSpend(api, eventId);

      // A question the tools can answer from real event data, phrased so the
      // assistant has no reason to propose a write action.
      const turn = await api.json<{ messages: { role: string; content: string }[] }>(
        await api.post(`events/${eventId}/chat/conversations/${conversation.id}/messages`, {
          data: { content: 'How many tournaments does this event have? Just answer, do nothing.' },
        }),
      );

      const assistant = turn.messages.filter((m) => m.role === 'assistant');
      expect(assistant.length, 'the assistant must have taken a turn').toBeGreaterThan(0);
      expect(
        turn.messages.some((m) => m.role === 'user'),
        'the user turn is persisted too',
      ).toBe(true);

      const after = await eventSpend(api, eventId);
      expect(after.callCount, 'chat turns must be metered like any other feature').toBeGreaterThan(
        before.callCount,
      );

      // The transcript survives a reload — the chat is not just a response body.
      const reloaded = await api.json<{ messages: { role: string }[] }>(
        await api.get(`events/${eventId}/chat/conversations/${conversation.id}`),
      );
      expect(reloaded.messages.length, 'the transcript is stored, not just returned').toBe(
        turn.messages.length,
      );

      const renamed = await api.json<{ title: string }>(
        await api.patch(`events/${eventId}/chat/conversations/${conversation.id}`, {
          data: { title: 'E2E chat renamed' },
        }),
      );
      expect(renamed.title).toBe('E2E chat renamed');

      // The streaming endpoint. The loop is not token-streamed — it emits
      // turn-level progress events — so the assertion is that FRAMES arrive,
      // which is what keeps the UI from looking hung during a multi-turn run.
      const stream = await api.ok(
        await api.post(`events/${eventId}/chat/conversations/${conversation.id}/messages/stream`, {
          data: { content: 'And how many pistes? Just answer.' },
        }),
      );
      const body = await stream.text();
      expect(body, 'the stream must be SSE frames, not one JSON blob').toContain('data:');
      expect(body, 'the loop must surface what it is doing between turns').toMatch(
        /"type"\s*:\s*"(status|assistant|tool|notice)"/,
      );
    } finally {
      await api.delete(`events/${eventId}/chat/conversations/${conversation.id}`);
    }
  });

  test('setup assistant: a draft is proposed, reviewed, and never auto-applied', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { eventId } = runContext();

    const draft = await api.json<{
      id: string;
      draftType: string;
      status: string;
      proposedActions: unknown[];
      validationState: { ok: boolean };
    }>(
      await api.post(`events/${eventId}/ai-assistant/drafts`, {
        data: {
          draftType: 'tournament_config',
          prompt: 'A one-day longsword tournament for 16 fighters, pools then a bracket.',
        },
      }),
    );

    expect(draft.draftType).toBe('tournament_config');
    // 'failed' is a legitimate outcome: a cheap model can return unparseable
    // JSON, and the service records that verbatim rather than throwing. What
    // must NEVER happen is 'applied' — V1 is draft-and-review only, and an
    // assistant that writes to the tournament without a human is the one
    // failure this whole surface is shaped to prevent.
    expect(['draft', 'ready', 'failed']).toContain(draft.status);
    expect(draft.status, 'a fresh draft must never be applied').not.toBe('applied');
    expect(Array.isArray(draft.proposedActions), 'actions are structured, not prose').toBe(true);

    const listed = await api.json<{ id: string }[]>(
      await api.get(`events/${eventId}/ai-assistant/drafts`),
    );
    expect(
      listed.some((d) => d.id === draft.id),
      'the draft must appear in the list',
    ).toBe(true);

    const rejected = await api.json<{ status: string }>(
      await api.patch(`events/${eventId}/ai-assistant/drafts/${draft.id}`, {
        data: { status: 'rejected' },
      }),
    );
    expect(rejected.status).toBe('rejected');

    // Applying is deliberately not exercised for real: apply dispatches into
    // the deterministic tournament/phase/schedule writers, which 20-schedule
    // and 02-create-tournament already own. What IS asserted is the gate.
    const apply = await api.post(`events/${eventId}/ai-assistant/drafts/${draft.id}/apply`);
    expect(apply.status(), 'only ready drafts may be applied').toBe(400);
  });

  test('fighter insight: own key, own data, own decision to publish', async ({ request }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);

    const me = await api.json<{ profiles?: { globalPerson?: { id?: string } | null } }>(
      await api.get('me'),
    );
    const globalPersonId = me.profiles?.globalPerson?.id ?? null;
    test.skip(
      !globalPersonId,
      `${process.env.E2E_ADMIN_EMAIL ?? 'the E2E account'} has no claimed global_persons row, so ` +
        'the personal-space AI has no identity to work from. Claiming goes through a ' +
        'super-admin-reviewed request, which this spec must not self-approve — claim the ' +
        'account once by hand to enable this leg.',
    );

    // The fighter scope is a SEPARATE key store: their key, their cost, no org
    // or event budget. Installing here proves the second scope works, not just
    // the org one.
    const fighterKey = await installKey(api, FIGHTER_KEYS_PATH, {
      label: label('fighter key'),
      provider: live!.provider,
      apiKey: live!.apiKey,
      model: live!.model,
      monthlyBudgetEur: live!.budgetEur,
    });

    try {
      const insight = await api.json<GeneratedContent>(await api.post('me/insight/generate'));
      expect(insight.content.trim().length).toBeGreaterThan(0);
      expect(insight.status, 'an insight is private until the fighter says otherwise').toBe(
        'draft',
      );

      const publicPath = `public/generated-content/fighter_insight/${globalPersonId}`;
      expect(
        await api.json<GeneratedContent | null>(await api.get(publicPath)),
        'a private insight must not appear on the public profile',
      ).toBeNull();

      await api.ok(await api.post('me/insight/publish'));
      const shown = await api.json<GeneratedContent>(await api.get(publicPath));
      expect(shown?.content).toBe(insight.content);

      await api.ok(await api.post('me/insight/unpublish'));
      expect(
        await api.json<GeneratedContent | null>(await api.get(publicPath)),
        'unpublishing must take it off the public profile',
      ).toBeNull();
    } finally {
      await fighterKey.restore();
    }
  });
});
