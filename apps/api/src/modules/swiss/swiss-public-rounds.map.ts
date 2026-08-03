import type { SideColors } from '../events/side-colors';

/**
 * Pure projection of the Swiss rounds as a spectator sees them.
 *
 * Separate from the service because the joining is the part with the traps —
 * a bout carries registration ids, and a page that renders a UUID where a name
 * belongs is the failure this file exists to prevent. Testable with no
 * Supabase mock chain.
 */

export interface SwissFighter {
  registrationId: string;
  fighterName: string;
  clubAbbrev: string | null;
}

/** `swiss_entrants` with the name embed the standings loader also uses. */
export interface EntrantNameRow {
  registration_id: string;
  registrations?: {
    persons?: {
      given_name?: string | null;
      family_name?: string | null;
      clubs?: { name?: string | null; abbreviation?: string | null } | null;
    } | null;
  } | null;
}

export interface PublicRoundRow {
  id: string;
  round_number: number;
  status: string;
  bye_registration_id: string | null;
  pairing_meta_json: Record<string, unknown> | null;
}

export interface PublicMatchRow {
  id: string;
  swiss_round_id: string | null;
  match_number_label: string | null;
  status: string;
  scheduled_at: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
  red_score: number | null;
  blue_score: number | null;
  winner_registration_id: string | null;
  lices?: { name?: string | null; color_hex?: string | null } | null;
}

export interface PublicSwissMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  redRegistrationId: string | null;
  redFighterName: string | null;
  redClubAbbrev: string | null;
  redScore: number | null;
  blueRegistrationId: string | null;
  blueFighterName: string | null;
  blueClubAbbrev: string | null;
  blueScore: number | null;
  /** Authoritative over comparing scores — a forfeit can win on the lower score. */
  winnerRegistrationId: string | null;
  liceName: string | null;
  liceColorHex: string | null;
}

export interface PublicSwissRound {
  id: string;
  roundNumber: number;
  status: string;
  /** Engine warnings — forced rematches and singleton bands, badged publicly. */
  warnings: unknown;
  byeRegistrationId: string | null;
  byeFighterName: string | null;
  manuallyAdjusted: boolean;
  matches: PublicSwissMatch[];
}

export interface PublicSwissRounds {
  phaseId: string | null;
  roundCount: number;
  roundsCompleted: number;
  /** Non-null once the organiser froze the standings (decision 13). */
  finalized: { atRound: number; at: string } | null;
  sideColors: SideColors;
  rounds: PublicSwissRound[];
}

/** registrationId → name + club, from the entrant embed. */
export function buildFighterIndex(rows: EntrantNameRow[]): Map<string, SwissFighter> {
  const index = new Map<string, SwissFighter>();
  for (const row of rows) {
    const person = row.registrations?.persons ?? null;
    const name = `${person?.given_name ?? ''} ${person?.family_name ?? ''}`.trim();
    index.set(row.registration_id, {
      registrationId: row.registration_id,
      fighterName: name,
      clubAbbrev: person?.clubs?.abbreviation ?? person?.clubs?.name ?? null,
    });
  }
  return index;
}

/**
 * Rounds with their bouts, ordered by round then by the board number encoded in
 * `SW-R<n>-M<b>`. Sorting on the label as a plain string would put board 10
 * before board 2, so the numeric tail is compared as a number.
 */
export function toPublicRounds(
  rounds: PublicRoundRow[],
  matches: PublicMatchRow[],
  fighters: Map<string, SwissFighter>,
): PublicSwissRound[] {
  const byRound = new Map<string, PublicMatchRow[]>();
  for (const match of matches) {
    if (!match.swiss_round_id) continue;
    const bucket = byRound.get(match.swiss_round_id);
    if (bucket) bucket.push(match);
    else byRound.set(match.swiss_round_id, [match]);
  }

  return rounds.map((round) => {
    const meta = round.pairing_meta_json ?? {};
    const adjustments = meta['manualAdjustments'];
    return {
      id: round.id,
      roundNumber: round.round_number,
      status: round.status,
      warnings: meta['warnings'] ?? [],
      byeRegistrationId: round.bye_registration_id,
      byeFighterName: round.bye_registration_id
        ? (fighters.get(round.bye_registration_id)?.fighterName ?? null)
        : null,
      manuallyAdjusted: Array.isArray(adjustments) && adjustments.length > 0,
      matches: (byRound.get(round.id) ?? [])
        .sort((a, b) => boardNumber(a.match_number_label) - boardNumber(b.match_number_label))
        .map((match) => toPublicMatch(match, fighters)),
    };
  });
}

function toPublicMatch(row: PublicMatchRow, fighters: Map<string, SwissFighter>): PublicSwissMatch {
  const red = row.red_registration_id ? fighters.get(row.red_registration_id) : undefined;
  const blue = row.blue_registration_id ? fighters.get(row.blue_registration_id) : undefined;
  return {
    id: row.id,
    matchNumberLabel: row.match_number_label ?? '',
    status: row.status,
    scheduledAt: row.scheduled_at,
    redRegistrationId: row.red_registration_id,
    redFighterName: red?.fighterName ?? null,
    redClubAbbrev: red?.clubAbbrev ?? null,
    redScore: row.red_score,
    blueRegistrationId: row.blue_registration_id,
    blueFighterName: blue?.fighterName ?? null,
    blueClubAbbrev: blue?.clubAbbrev ?? null,
    blueScore: row.blue_score,
    winnerRegistrationId: row.winner_registration_id,
    liceName: row.lices?.name ?? null,
    liceColorHex: row.lices?.color_hex ?? null,
  };
}

/**
 * Board number out of `SW-R3-M12`; 0 when the label is missing or unparsable.
 *
 * Exported because the admin projection orders the same bouts, and sorting the
 * labels as plain strings there instead would put board 10 above board 2 on one
 * surface and not the other.
 */
export function boardNumber(label: string | null): number {
  const match = /M(\d+)$/.exec(label ?? '');
  return match ? Number(match[1]) : 0;
}
