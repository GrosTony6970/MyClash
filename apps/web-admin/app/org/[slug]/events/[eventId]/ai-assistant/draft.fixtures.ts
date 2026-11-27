import type { ReadableDraftAction } from '@myclash/types';
import type { AssistantDraft } from '@/components/ai/assistant-draft';

/**
 * Drafts as the assistant answers them, one of each kind, for the page's and the chat card's
 * tests. Every id is a uuid, so a test can prove none of them reaches the screen: the raw
 * actions hold them, and only the names (`readable`) may show.
 */
export const DRAFT_ID = '0b9c5a52-5f0e-4c43-9d0e-3f1f3f3b1a01';
export const OLDER_DRAFT_ID = '7d4e2b10-1c3a-4f5e-8a9b-0c1d2e3f4a5b';
const TOURNAMENT = 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5';
const MATCH = 'c3c3c3c3-d4d4-4e5e-8f6f-a7a7a7a7a7a7';
const LICE = 'e5e5e5e5-f6f6-4a7a-8b8b-c9c9c9c9c9c9';

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A ready draft holding `readable`; its raw actions carry the ids the names stand for. */
export function draftOf(
  readable: ReadableDraftAction[],
  extra: Partial<AssistantDraft> = {},
): AssistantDraft & { proposedActions: unknown[] } {
  return {
    id: DRAFT_ID,
    tournamentId: TOURNAMENT,
    draftType: 'pool_plan',
    prompt: 'Claude proposed: generate_pools',
    summary: null,
    proposedActions: [
      { kind: 'schedule_match', matchId: MATCH, liceId: LICE, tournament: TOURNAMENT },
    ],
    readable,
    validationState: { ok: true, warnings: [], errors: [] },
    status: 'ready',
    applyStarted: false,
    error: null,
    ...extra,
  };
}

/** The story's draft: Marie reads it in these words. */
export const POOLS: ReadableDraftAction = {
  kind: 'generate_pools',
  tournament: { name: 'Longsword Open' },
  poolCount: 4,
  schoolSeparation: true,
};
export const POOLS_EN = 'Make 4 Pools in Longsword Open — clubs kept apart';
export const POOLS_FR = 'Faire 4 poules dans Longsword Open — clubs séparés';

/** One action of each kind, and the line it reads as. */
export const EACH_KIND: Array<[string, ReadableDraftAction, string]> = [
  [
    'create_tournament',
    { kind: 'create_tournament', name: 'Sabre Open', slug: 'sabre-open', weapon: 'sabre' },
    'Create the Tournament Sabre Open — web address sabre-open, weapon: sabre',
  ],
  ['generate_pools', POOLS, POOLS_EN],
  [
    'generate_bracket',
    {
      kind: 'generate_bracket',
      tournament: { name: 'Longsword Open' },
      phaseType: 'single_elim',
      qualifyCount: 16,
      poolPhase: { type: 'pool', tournament: 'Longsword Open' },
    },
    'Make the bracket of Longsword Open — single elimination, top 16 qualify, seeded from the Pools of Longsword Open',
  ],
  [
    'schedule_match',
    {
      kind: 'schedule_match',
      match: { code: 'LSW-P2-M04', tournament: 'Longsword Open' },
      piste: { name: 'Piste 2' },
      // 13:30 UTC is 08:30 on a New York Event's wall clock, in December.
      startsAt: '2026-12-05T13:30:00.000Z',
      timezone: 'America/New_York',
    },
    'Put LSW-P2-M04 of Longsword Open on Piste 2 at Sat 5 Dec, 08:30',
  ],
  [
    'assign_referee',
    {
      kind: 'assign_referee',
      referee: { name: 'Paul Martin' },
      role: { name: 'Lead referee' },
      pool: { number: 2, tournament: 'Longsword Open' },
    },
    'Assign Paul Martin as Lead referee to Pool 2 of Longsword Open',
  ],
  [
    'rows removed since',
    {
      kind: 'schedule_match',
      match: { missing: true },
      piste: { missing: true },
      startsAt: null,
      timezone: 'Europe/Paris',
    },
    'Put a bout removed since on a piste removed since, at a time that cannot be read',
  ],
  [
    'unsupported',
    { kind: 'unsupported' },
    'An action MyClash does not know. It cannot be applied.',
  ],
];

/** A failure the API answers, in `apiRequest`'s shape. */
export const httpFailure = (status: number, code: string, detail: string) => ({
  ok: false as const,
  kind: 'http' as const,
  status,
  detail,
  validationErrors: null,
  code,
  details: null,
});

/** Where the page reads the Event's drafts, and one of them. */
export const DRAFTS_READ = '/api/v1/events/ev1/ai-assistant/drafts';
export const DRAFT_READ = `${DRAFTS_READ}/${DRAFT_ID}`;
