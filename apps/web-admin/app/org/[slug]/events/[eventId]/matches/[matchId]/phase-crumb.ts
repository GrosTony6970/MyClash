import { withTournament } from '@/lib/tournament-choice';

/**
 * The crumb from a bout back to the page of its phase, on its own Tournament (quick win
 * O28): a Pool bout goes to the Pools page's bouts tab, a Swiss bout to the rounds tab, an
 * elimination bout to the bracket. A bout whose phase is unknown has no such crumb.
 */
export type PhaseType = 'pool' | 'single_elim' | 'double_elim' | 'swiss';

const PHASE_PAGE: Record<PhaseType, { path: string; tab: string; label: PhaseCrumbKey }> = {
  pool: { path: 'pools', tab: 'matches', label: 'organizer.matchDetail.crumbPools' },
  swiss: { path: 'swiss', tab: 'rounds', label: 'organizer.matchDetail.crumbSwiss' },
  single_elim: { path: 'bracket', tab: 'bracket', label: 'organizer.matchDetail.crumbBracket' },
  double_elim: { path: 'bracket', tab: 'bracket', label: 'organizer.matchDetail.crumbBracket' },
};

type PhaseCrumbKey =
  | 'organizer.matchDetail.crumbPools'
  | 'organizer.matchDetail.crumbSwiss'
  | 'organizer.matchDetail.crumbBracket';

export function phaseCrumb(
  eventBase: string,
  phaseType: PhaseType | null,
  tournamentId: string,
): { href: string; label: PhaseCrumbKey } | null {
  if (!phaseType) return null;
  const page = PHASE_PAGE[phaseType];
  return {
    href: withTournament(`${eventBase}/${page.path}#${page.tab}`, tournamentId),
    label: page.label,
  };
}
