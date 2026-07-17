import React from 'react';
import { renderToString } from 'react-dom/server';

const RENDER_BUDGET_MS = 1_000;
const FIGHTER_COUNT = 100;

(globalThis as typeof globalThis & { React: typeof React }).React = React;

type FetchResponseBody = Record<string, unknown> | Array<Record<string, unknown>>;

function jsonResponse(body: FetchResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const fighters = Array.from({ length: FIGHTER_COUNT }, (_, index) => ({
  registrationId: `registration-${index}`,
  givenName: `Fighter${index}`,
  familyName: `Perf${index}`,
  clubName: `Club ${index % 10}`,
  doubles: index % 4,
  hitsGiven1: 10 + (index % 5),
  afterblowGiven1: index % 3,
  hitsGiven2: 5 + (index % 4),
  afterblowGiven2: index % 2,
  hitsReceived1: 8 + (index % 4),
  afterblowReceived1: index % 3,
  hitsReceived2: 4 + (index % 2),
  afterblowReceived2: index % 2,
  blowsGiven: 20 + index,
  blowsReceived: 12 + index,
  afterblowsReceivedTotal: index % 5,
  pointsGiven: 30 + index,
  pointsReceived: 18 + index,
  totalExchanges: 25 + (index % 10),
  hitRatio: (20 + index) / (12 + index),
  pointRatio: (30 + index) / (18 + index),
}));

globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
  const url = String(input);

  // Mirrors the real slug → id resolution the page performs. This mock used to
  // answer the bare `events/perf-event/tournaments/perf-tournament` with
  // `{ id }` — a route that has never existed. Because `includes()` is a
  // substring test it matched anyway, so this harness passed green against a
  // fiction while the real page 404'd and rendered nothing. Match the full path.
  if (url.includes('/api/v1/events/perf-event/tournaments/perf-tournament/standings')) {
    return jsonResponse({ tournament: { id: 'tournament-perf' } });
  }

  if (url.includes('/api/v1/tournaments/tournament-perf/stats/overview')) {
    return jsonResponse({
      tournamentId: 'tournament-perf',
      participantCount: FIGHTER_COUNT,
      matchCount: 240,
      exchangeCount: 2_400,
      doublesCount: 180,
      doublesPercent: 7.5,
      clubCount: 10,
      topFighters: fighters.slice(0, 5).map((fighter) => ({
        name: `${fighter.givenName} ${fighter.familyName}`,
        club: fighter.clubName,
        hitRatio: fighter.hitRatio,
        blowsGiven: fighter.blowsGiven,
        blowsReceived: fighter.blowsReceived,
      })),
    });
  }

  if (url.includes('/api/v1/tournaments/tournament-perf/stats/fighters')) {
    return jsonResponse(fighters);
  }

  return new Response(null, { status: 404 });
};

async function main(): Promise<void> {
  const { default: StatsPage } = await import('../app/e/[eventSlug]/t/[tournamentSlug]/stats/page');
  const start = performance.now();
  const element = await StatsPage({
    params: Promise.resolve({ eventSlug: 'perf-event', tournamentSlug: 'perf-tournament' }),
  });
  const html = renderToString(element);
  const elapsed = performance.now() - start;

  if (!html.includes('Fighter0') || !html.includes('Fighter99')) {
    throw new Error(
      `Stats page did not render the 100-fighter table fixture: ${html.slice(0, 240)}`,
    );
  }

  if (elapsed > RENDER_BUDGET_MS) {
    throw new Error(
      `Stats page rendered ${FIGHTER_COUNT} fighters in ${elapsed.toFixed(1)}ms, above ${RENDER_BUDGET_MS}ms budget.`,
    );
  }

  console.log(
    `Stats page rendered ${FIGHTER_COUNT} fighters in ${elapsed.toFixed(1)}ms (budget ${RENDER_BUDGET_MS}ms).`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
