import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import type { SwissPairingService } from './swiss-pairing.service';

/**
 * Loading the picture an override needs before it can decide anything.
 *
 * Split from SwissOverrideService so that file is only the override RULES —
 * who may move, what warns, what is written. This is the gathering: the round
 * and its bouts, everyone's prior opponents and byes (for the rematch and
 * repeat-bye warnings) and club affiliations (for the same-club warning).
 */

export interface MatchRow {
  id: string;
  status: string;
  swiss_round_id?: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
}

export type Position = { kind: 'bye' } | { kind: 'match'; match: MatchRow; side: 'red' | 'blue' };

export interface OverrideWarning {
  code: 'creates-rematch' | 'repeat-bye' | 'same-club';
  registrationIds: string[];
}

export interface EditableRound {
  id: string;
  phaseId: string;
  roundNumber: number;
  status: string;
  byeRegistrationId: string | null;
  pairingMeta: Record<string, unknown> | null;
  matches: MatchRow[];
  /** Who each fighter has already faced, EXCLUDING this round. */
  priorOpponents: Map<string, Set<string>>;
  /** Who has already sat a round out, excluding this one. */
  priorByes: Set<string>;
  clubByRegistration: Map<string, string>;
}

export async function loadEditableRoundData(
  supabase: SupabaseService,
  pairing: SwissPairingService,
  roundId: string,
): Promise<EditableRound> {
  const { data, error } = await supabase.service
    .from('swiss_rounds')
    .select(
      'id, phase_id, round_number, status, bye_registration_id, pairing_meta_json, ' +
        'matches(id, status, red_registration_id, blue_registration_id)',
    )
    .eq('id', roundId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Swiss round ${roundId} not found`);

  // Double cast: the concatenated select string defeats Supabase's literal type
  // inference, which then resolves the row type to GenericStringError.
  const row = data as unknown as Record<string, unknown>;
  const phaseId = row['phase_id'] as string;
  const { priorOpponents, priorByes } = priorMeetings(await pairing.loadRounds(phaseId), roundId);

  return {
    id: roundId,
    phaseId,
    roundNumber: row['round_number'] as number,
    status: row['status'] as string,
    byeRegistrationId: (row['bye_registration_id'] as string | null) ?? null,
    pairingMeta: (row['pairing_meta_json'] as Record<string, unknown> | null) ?? null,
    matches: (row['matches'] ?? []) as MatchRow[],
    priorOpponents,
    priorByes,
    clubByRegistration: await clubsFor(supabase, phaseId),
  };
}

/**
 * Who has faced whom, and who has sat out, in every round EXCEPT this one.
 *
 * Excluding the round being edited is the point: a swap inside it must not warn
 * that it is recreating the very pairing it is replacing.
 */
function priorMeetings(
  rounds: Array<{
    id: string;
    byeRegistrationId: string | null;
    matches: Array<{ redRegistrationId: string | null; blueRegistrationId: string | null }>;
  }>,
  excludeRoundId: string,
): { priorOpponents: Map<string, Set<string>>; priorByes: Set<string> } {
  const priorOpponents = new Map<string, Set<string>>();
  const priorByes = new Set<string>();

  for (const prior of rounds) {
    if (prior.id === excludeRoundId) continue;
    if (prior.byeRegistrationId) priorByes.add(prior.byeRegistrationId);
    for (const match of prior.matches) {
      const { redRegistrationId: red, blueRegistrationId: blue } = match;
      if (!red || !blue) continue;
      if (!priorOpponents.has(red)) priorOpponents.set(red, new Set());
      if (!priorOpponents.has(blue)) priorOpponents.set(blue, new Set());
      priorOpponents.get(red)!.add(blue);
      priorOpponents.get(blue)!.add(red);
    }
  }
  return { priorOpponents, priorByes };
}

/** Club per registration, for the same-club pairing warning. */
async function clubsFor(supabase: SupabaseService, phaseId: string): Promise<Map<string, string>> {
  const { data } = await supabase.service
    .from('swiss_entrants')
    .select('registration_id, registrations(persons(club_id))')
    .eq('phase_id', phaseId);
  const out = new Map<string, string>();
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const reg = row['registrations'] as { persons?: { club_id?: string | null } } | null;
    const clubId = reg?.persons?.club_id;
    if (clubId) out.set(row['registration_id'] as string, clubId);
  }
  return out;
}
