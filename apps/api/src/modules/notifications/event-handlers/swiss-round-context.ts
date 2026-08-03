import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Everything the `swiss_round_published` message needs, loaded once.
 *
 * Split out of NotificationEventsService because it is the only handler there
 * that has to resolve a whole round — the phase, its tournament, its event and
 * every pairing on it — before it can write a single body line. Leaving it
 * inline pushed that file past the 400-line limit and buried the fan-out logic
 * under three queries.
 */

/** Tournament statuses whose Swiss pairings are already public. */
const PUBLIC_TOURNAMENT_STATUSES = ['published', 'running', 'completed'];

export interface SwissRoundContext {
  roundNumber: number;
  phaseId: string;
  tournamentName: string;
  url: string;
  /** The body line for one entrant: their pairing, their piste, or their bye. */
  opponentLine: (registrationId: string) => string;
}

/**
 * The round, or null when it does not exist or its tournament is not public.
 *
 * The status gate lives here rather than at the call site because it is the
 * reason this returns null at all: generating a Swiss phase on a `draft`
 * tournament to try the format out must not message the whole field.
 */
export async function loadSwissRoundContext(
  supabase: SupabaseService,
  roundId: string,
): Promise<SwissRoundContext | null> {
  const { data } = await supabase.service
    .from('swiss_rounds')
    .select(
      'id, round_number, phase_id, bye_registration_id, ' +
        'phases ( tournaments ( name, slug, status, events ( slug ) ) )',
    )
    .eq('id', roundId)
    .maybeSingle();

  const round = data as SwissRoundRow | null;
  const tournament = round?.phases?.tournaments;
  if (!round || !tournament) return null;
  if (!PUBLIC_TOURNAMENT_STATUSES.includes(tournament.status ?? '')) return null;

  const opponents = await loadOpponents(supabase, roundId);
  const names = await resolveRegistrationNames(supabase, [
    ...new Set([...opponents.values()].map((pairing) => pairing.opponentId)),
  ]);

  return {
    roundNumber: round.round_number,
    phaseId: round.phase_id,
    tournamentName: tournament.name ?? 'Tournament',
    url:
      tournament.events?.slug && tournament.slug
        ? `/e/${tournament.events.slug}/t/${tournament.slug}#swiss`
        : '/notifications',
    opponentLine: (registrationId) => buildLine(registrationId, round, opponents, names),
  };
}

interface SwissRoundRow {
  round_number: number;
  phase_id: string;
  bye_registration_id: string | null;
  phases?: {
    tournaments?: {
      name?: string | null;
      slug?: string | null;
      status?: string | null;
      events?: { slug?: string | null } | null;
    } | null;
  } | null;
}

interface Pairing {
  opponentId: string;
  liceName: string | null;
}

function buildLine(
  registrationId: string,
  round: SwissRoundRow,
  opponents: Map<string, Pairing>,
  names: Map<string, string>,
): string {
  if (registrationId === round.bye_registration_id) {
    return `You have a bye in round ${round.round_number}.`;
  }
  const pairing = opponents.get(registrationId);
  if (!pairing) return `Round ${round.round_number} pairings are published.`;
  const opponent = names.get(pairing.opponentId) ?? 'your next opponent';
  return pairing.liceName
    ? `Round ${round.round_number}: you face ${opponent} on ${pairing.liceName}.`
    : `Round ${round.round_number}: you face ${opponent}.`;
}

/** registrationId → who they face and where, both directions per bout. */
async function loadOpponents(
  supabase: SupabaseService,
  roundId: string,
): Promise<Map<string, Pairing>> {
  const { data } = await supabase.service
    .from('matches')
    .select('red_registration_id, blue_registration_id, lices ( name )')
    .eq('swiss_round_id', roundId);

  const opponents = new Map<string, Pairing>();
  for (const match of (data ?? []) as Array<{
    red_registration_id: string | null;
    blue_registration_id: string | null;
    lices?: { name?: string | null } | null;
  }>) {
    const liceName = match.lices?.name ?? null;
    const red = match.red_registration_id;
    const blue = match.blue_registration_id;
    if (!red || !blue) continue;
    opponents.set(red, { opponentId: blue, liceName });
    opponents.set(blue, { opponentId: red, liceName });
  }
  return opponents;
}

/** registrationId → display name, for the pairing line. */
async function resolveRegistrationNames(
  supabase: SupabaseService,
  registrationIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (registrationIds.length === 0) return names;
  const { data } = await supabase.service
    .from('registrations')
    .select('id, persons ( given_name, family_name )')
    .in('id', registrationIds);
  for (const row of (data ?? []) as Array<{
    id: string;
    persons?: { given_name?: string | null; family_name?: string | null } | null;
  }>) {
    const name = `${row.persons?.given_name ?? ''} ${row.persons?.family_name ?? ''}`.trim();
    if (name) names.set(row.id, name);
  }
  return names;
}
