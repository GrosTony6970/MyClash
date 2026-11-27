/**
 * One key for a side of a Match. A side is a Registration (an individual) or a Team, never both
 * (ADR-022, docs/decisions/ADR-022-team-is-a-second-kind-of-side.md). The key is the id of that one
 * side, or null while the side is not known yet (a bracket placeholder). An empty string is not an
 * id.
 */
export function sideKey(
  registrationId: string | null | undefined,
  teamId: string | null | undefined,
): string | null {
  if (registrationId && teamId) {
    throw new Error(
      'a side is either a Registration or a Team, not both a Registration and a Team',
    );
  }
  return registrationId || teamId || null;
}
