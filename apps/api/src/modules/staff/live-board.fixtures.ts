// Builders for the live-board assembly tests.
//
// Every field of the raw row shapes has a default here, so a test names only
// what it is actually asserting on. That matters more than usual for this
// module: the payload gained a dozen fields at once, and a fixture that spells
// them all out inline turns every future field into a mass edit of unrelated
// cases.

import type { BoardAccountInput, RawBoardLice, RawBoardMatch, AssembleInput } from './live-board';
import type { ResolvedReferee } from '../matches/resolve-match-referees';

export function lice(over: Partial<RawBoardLice> = {}): RawBoardLice {
  return {
    id: 'L1',
    name: 'Piste 1',
    sort_order: 0,
    location_label: null,
    color_hex: null,
    venues: null,
    venue_areas: null,
    ...over,
  };
}

export function match(over: Partial<RawBoardMatch> = {}): RawBoardMatch {
  return {
    id: 'm1',
    lice_id: 'L1',
    status: 'running',
    red_score: 0,
    blue_score: 0,
    match_number_label: '#1',
    scheduled_at: null,
    started_at: null,
    ended_at: null,
    pool_id: null,
    bracket_slots: null,
    red: null,
    blue: null,
    ...over,
  };
}

export function account(over: Partial<BoardAccountInput> = {}): BoardAccountInput {
  return {
    id: 'a1',
    display_name: 'Léa',
    username: 'lea',
    status: 'active',
    last_seen_at: null,
    outbox_depth: 0,
    oldest_pending_age_seconds: 0,
    rejected_count: 0,
    clock_skew_ms: null,
    needs_attention: false,
    needs_attention_reason: null,
    ...over,
  };
}

/** One piste, nothing on it. */
export function base(): AssembleInput {
  return {
    lices: [lice()],
    matches: [],
    recentCompleted: [],
    accounts: [],
    assignments: [],
    refereesByMatchId: new Map<string, ResolvedReferee[]>(),
  };
}
