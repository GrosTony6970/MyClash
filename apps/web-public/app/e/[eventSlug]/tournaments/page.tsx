/**
 * Public tournaments full list — the "see full list" target from the event
 * home's Tournaments section. Mirrors the /workshops list layout.
 */

import type { Metadata } from 'next';
import { createTranslator, getMessages } from '@myclash/i18n';
import { getServerApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { EventHeader, fetchEventInfo } from '../_components/EventHeader';
import { resolveServerLocale } from '@myclash/next-i18n/server';
import { fetchTournaments } from '../home/_lib/public-event-data';
import { TournamentCard } from '../home/_components/TournamentCard';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  return { title: `Tournaments — ${eventSlug}` };
}

export default async function TournamentsListPage({ params }: Props) {
  const { eventSlug } = await params;
  const apiUrl = getServerApiUrl();
  const locale = await resolveServerLocale();
  const tr = createTranslator(getMessages(locale));
  const event = await fetchEventInfo(eventSlug, apiUrl);
  const tournaments = await fetchTournaments(event?.id ?? '', apiUrl);
  const tz = event?.timezone ?? 'Europe/Paris';

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:max-w-6xl">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={tr('publicApp.eventHome.backToHome')}
        className="mb-1"
      />
      {event && <EventHeader event={event} locale={locale} eventSlug={eventSlug} />}
      <section>
        <h1 className="mb-4 font-display text-2xl font-bold text-foreground sm:text-3xl">
          {tr('publicApp.eventHome.section.tournaments')}
        </h1>
        {tournaments.length === 0 ? (
          <p className="text-sm text-muted">{tr('publicApp.eventHome.tournaments.empty')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => (
              <TournamentCard
                key={t.id}
                tournament={t}
                eventSlug={eventSlug}
                tz={tz}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
