// Semantic accent token per commitment kind, used by the schedule section dots
// and the card accent stripe so the three kinds read consistently:
//   fight/tournament = blue (accent), referee = orange (warning),
//   workshop = green (success).
// Tokens only (no raw colours) — see @myclash/ui theme tokens.

export type CommitmentKind = 'fight' | 'referee' | 'workshop';

export function kindAccentClass(kind: CommitmentKind): string {
  return kind === 'referee' ? 'bg-warning' : kind === 'workshop' ? 'bg-success' : 'bg-accent';
}
