import Link from 'next/link';
import { getApiUrl } from '@/lib/api-url';
import { getServerT } from '@/i18n/server-locale';

interface League {
  id: string;
  slug: string;
  name: string;
  season_year: number;
  description: string | null;
}

async function fetchLeagues(apiUrl: string): Promise<League[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/leagues`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as League[];
  } catch {
    return [];
  }
}

export default async function PublicLeaguesPage() {
  const t = await getServerT();
  const apiUrl = getApiUrl();
  const leagues = await fetchLeagues(apiUrl);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-7">
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {t('admin.dashboard.leaguesTitle')}
        </h1>
        <p className="text-sm text-muted mt-1">{t('admin.dashboard.leaguesDescription')}</p>
      </div>

      <div className="grid gap-4">
        {leagues.map((league) => (
          <Link
            key={league.id}
            href={`/leagues/${league.slug}`}
            className="rounded-lg border border-border bg-surface p-5 hover:border-accent"
          >
            <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
              {league.name}
            </h2>
            <p className="text-sm text-muted mt-1">{league.season_year}</p>
            {league.description && (
              <p className="text-sm text-foreground-secondary mt-3 leading-6">
                {league.description}
              </p>
            )}
          </Link>
        ))}
      </div>

      {leagues.length === 0 && <p className="text-sm text-muted">{t('admin.leagues.empty')}</p>}
    </main>
  );
}
