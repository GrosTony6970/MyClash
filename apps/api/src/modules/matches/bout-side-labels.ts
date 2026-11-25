import { sideLabel, type RegistrationEmbed, type SideLabel, type TeamEmbed } from './side-label';

/**
 * The two team sides of a `matches` read, beside its `red` / `blue` Registration embeds. A side is
 * one or the other (0282), so a read of a bout's sides asks for both kinds.
 */
export const TEAM_SIDE_EMBEDS =
  'red_team:teams!matches_red_team_id_fkey(id,name,color,logo_url),' +
  'blue_team:teams!matches_blue_team_id_fkey(id,name,color,logo_url)';

/** A bout row read with the `red` / `blue` Registration embeds and `TEAM_SIDE_EMBEDS`. */
export interface BoutSideEmbeds<Club> {
  red?: RegistrationEmbed<Club> | null;
  blue?: RegistrationEmbed<Club> | null;
  red_team?: TeamEmbed | null;
  blue_team?: TeamEmbed | null;
}

/** Both sides of a bout, each as `sideLabel` names it. */
export function boutSideLabels<Club>(row: BoutSideEmbeds<Club>): {
  red: SideLabel<Club>;
  blue: SideLabel<Club>;
} {
  return {
    red: sideLabel(row.red ?? null, row.red_team ?? null),
    blue: sideLabel(row.blue ?? null, row.blue_team ?? null),
  };
}

/**
 * The name a bout read sends for a side: null when no name is known (a bracket side not filled
 * yet, a Person not read). `sideLabel` answers `''` there; the screens put "Red" / "Blue" in its
 * place only for null (`?? t('scoring.lice.red')` in the pad's `MatchView.tsx`).
 */
export function sideName(label: SideLabel<unknown>): string | null {
  return label.name || null;
}

/** What every screen that names a bout shows of its sides (call 6): each name and colour chip. */
export function sideNamesAndColours(sides: { red: SideLabel<unknown>; blue: SideLabel<unknown> }) {
  return {
    redFighterName: sideName(sides.red),
    blueFighterName: sideName(sides.blue),
    redColour: sides.red.colour,
    blueColour: sides.blue.colour,
  };
}
