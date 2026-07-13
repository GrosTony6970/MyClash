import { test, expect, type APIResponse } from '@playwright/test';
import { runContext } from './_context';

/**
 * Schedule / programme planner coverage.
 *
 * 1. Smoke: the schedule workspace + programme planner load for the event.
 * 2. Generation: build the full precondition chain via API (lice → fighters →
 *    tournament → registrations → round-robin pool → one competition block) and
 *    assert programme/generate actually places matches (matchesScheduled > 0).
 *    All of it is event-scoped, so global-teardown's event hard-delete cleans
 *    it up. Driven via API (not the planner UI's dialogs) for reliability.
 */
test('schedule page loads with the programme planner', async ({ page }) => {
  const { orgSlug, eventId } = runContext();

  await page.goto(`/org/${orgSlug}/events/${eventId}/schedule`);

  await expect(page.getByTestId('schedule-suggest')).toBeVisible();
});

test('schedule: generate places pool matches on a lice', async ({ request }) => {
  const { eventId } = runContext();
  const api = (p: string) => `/api/v1/${p}`;
  const ok = async (res: APIResponse, label: string): Promise<APIResponse> => {
    if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text()}`);
    return res;
  };

  // The event starts with no lices — generate needs at least one to place on.
  await ok(
    await request.post(api(`events/${eventId}/lices`), { data: { name: 'E2E Piste A' } }),
    'create lice',
  );

  // 4 fighters → one round-robin pool (6 matches).
  const personIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await ok(
      await request.post(api(`events/${eventId}/persons`), {
        data: { givenName: `E2eFighter${i}`, familyName: 'Testrunner' },
      }),
      `create person ${i}`,
    );
    personIds.push(((await res.json()) as { id: string }).id);
  }

  const tRes = await ok(
    await request.post(api(`events/${eventId}/tournaments`), {
      data: { name: 'E2E Schedule Cup', slug: `e2e-sched-${Date.now().toString(36)}` },
    }),
    'create tournament',
  );
  const tournamentId = ((await tRes.json()) as { id: string }).id;

  for (const personId of personIds) {
    await ok(
      await request.post(api(`tournaments/${tournamentId}/registrations`), { data: { personId } }),
      'register fighter',
    );
  }

  await ok(
    await request.post(api(`tournaments/${tournamentId}/generate-pools`), {
      data: { poolCount: 1 },
    }),
    'generate pools',
  );

  // One competition block spanning the day, bound to the pool phase.
  await ok(
    await request.post(api(`events/${eventId}/programme/blocks`), {
      data: {
        dayIndex: 0,
        blockType: 'competition',
        label: 'E2E Pools',
        startTime: '09:00',
        endTime: '18:00',
        liceCount: 1,
        matchGapSeconds: 30,
        matchDurationMinutes: 5,
        competitionId: tournamentId,
        competitionPhase: 'pool',
      },
    }),
    'create competition block',
  );

  const genRes = await ok(
    await request.post(api(`events/${eventId}/programme/generate`), { data: {} }),
    'generate schedule',
  );
  const result = (await genRes.json()) as { matchesScheduled: number };
  expect(result.matchesScheduled).toBeGreaterThan(0);
});
