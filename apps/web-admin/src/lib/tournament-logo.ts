/**
 * Resolve the logo URL to show for a tournament, falling back to the
 * parent event when the tournament-level override is unset.
 *
 * Tournament logos are optional — most tournaments inherit visual
 * identity from the parent event. This helper centralises the fallback
 * rule (tournament -> event -> null) so every consumer site (public
 * tournament page, bracket header, schedule grid row label) renders the
 * same hierarchy without each duplicating the `??` chain.
 */
export function resolveTournamentLogo(
  tournament: { logoUrl?: string | null; logo_url?: string | null } | null | undefined,
  event: { logoUrl?: string | null; logo_url?: string | null } | null | undefined,
): string | null {
  const tournamentLogo = tournament?.logoUrl ?? tournament?.logo_url ?? null;
  const eventLogo = event?.logoUrl ?? event?.logo_url ?? null;
  return tournamentLogo ?? eventLogo ?? null;
}
