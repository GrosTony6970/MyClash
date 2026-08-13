import { getServerT } from '@myclash/next-i18n/server';
import { rankBadge } from './StandingsGroups';

export interface ClubStandingMember {
  fighterId: string;
  name: string;
  points: number;
}

export interface ClubStandingRow {
  clubId: string;
  name: string;
  city: string | null;
  totalPoints: number;
  memberCount: number;
  medalCount: number;
  topMembers: ClubStandingMember[];
}

export interface UnaffiliatedBucket {
  totalPoints: number;
  memberCount: number;
  medalCount: number;
}

/**
 * Club / team championship: clubs ranked by summed member points, with an
 * "Unaffiliated" row for club-less fighters appended below the ranked clubs. A
 * pure server component; renders nothing when there are no clubs.
 */
export async function ClubStandingsSection({
  clubs,
  unaffiliated,
}: {
  clubs: ClubStandingRow[];
  unaffiliated: UnaffiliatedBucket | null;
}) {
  const t = await getServerT();
  if (clubs.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('publicApp.leagues.clubsTitle')}
      </h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-background text-foreground-secondary">
            <tr className="text-xs font-semibold uppercase tracking-wider">
              <th className="px-3 py-2 text-left">{t('publicApp.leagues.rankColumn')}</th>
              <th className="px-3 py-2 text-left">{t('publicApp.leagues.clubColumn')}</th>
              <th className="px-3 py-2 text-right">{t('publicApp.leagues.membersColumn')}</th>
              <th className="px-3 py-2 text-right">{t('publicApp.leagues.medalsColumn')}</th>
              <th className="px-3 py-2 text-right">{t('publicApp.leagues.totalPointsColumn')}</th>
            </tr>
          </thead>
          <tbody className="text-foreground">
            {clubs.map((club, index) => (
              <tr key={club.clubId} className="border-t border-border even:bg-background/50">
                <td className="px-3 py-2 align-top">{rankBadge(index + 1)}</td>
                <td className="px-3 py-2 align-top">
                  <p className="font-medium text-foreground">{club.name}</p>
                  {club.city && <p className="text-xs text-muted">{club.city}</p>}
                  {club.topMembers.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted">
                      {t('publicApp.leagues.clubLedBy', {
                        names: club.topMembers.map((member) => member.name).join(', '),
                      })}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-right tabular-nums text-foreground-secondary">
                  {club.memberCount}
                </td>
                <td className="px-3 py-2 align-top text-right tabular-nums text-foreground-secondary">
                  {club.medalCount}
                </td>
                <td className="px-3 py-2 align-top text-right font-semibold tabular-nums text-foreground">
                  {club.totalPoints}
                </td>
              </tr>
            ))}
            {unaffiliated && (
              <tr className="border-t border-border bg-background/40 text-muted">
                <td className="px-3 py-2">—</td>
                <td className="px-3 py-2 italic">{t('publicApp.leagues.unaffiliatedLabel')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{unaffiliated.memberCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{unaffiliated.medalCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{unaffiliated.totalPoints}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
