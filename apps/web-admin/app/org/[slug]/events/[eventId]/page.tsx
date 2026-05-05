'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface EventInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  startDate: string;
  endDate: string;
  location: string | null;
}

export default function EventDetailPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [, setTournaments] = useState<Tournament[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([evRes, tourRes]) => {
        if (evRes.ok) setEvent((await evRes.json()) as EventInfo);
        if (tourRes.ok) setTournaments((await tourRes.json()) as Tournament[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  const sections = [
    { label: t('organizer.eventHub.sections.persons'), href: 'persons', icon: 'P' },
    { label: t('organizer.eventHub.sections.registrations'), href: 'registrations', icon: 'R' },
    { label: t('organizer.eventHub.sections.pools'), href: 'pools', icon: 'P' },
    { label: t('organizer.eventHub.sections.poolPopulator'), href: 'pool-populator', icon: 'G' },
    { label: t('organizer.eventHub.sections.bracket'), href: 'bracket', icon: 'B' },
    { label: t('organizer.eventHub.sections.schedule'), href: 'schedule', icon: 'S' },
    { label: t('organizer.eventHub.sections.referees'), href: 'referees', icon: 'J' },
    {
      label: t('organizer.eventHub.sections.refereeAssignments'),
      href: 'referee-assignments',
      icon: 'A',
    },
    { label: t('organizer.eventHub.sections.workshops'), href: 'workshops', icon: 'W' },
    { label: t('organizer.eventHub.sections.staff'), href: 'staff', icon: 'S' },
    { label: t('organizer.eventHub.sections.theme'), href: 'theme', icon: 'T' },
    { label: t('admin.dashboard.leaguesTitle'), href: 'leagues', icon: 'L' },
    { label: t('organizer.archive.navLabel'), href: 'archive', icon: 'A' },
  ];

  return (
    <main className="p-8 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href={`/org/${slug}`} className="hover:text-gray-700">
          {slug}
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{event?.name ?? eventId}</span>
      </div>

      {event && (
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {event.location ? `${event.location} - ` : ''}
            {new Date(event.startDate).toLocaleDateString('fr-FR')}
            {event.startDate !== event.endDate
              ? ` - ${new Date(event.endDate).toLocaleDateString('fr-FR')}`
              : ''}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={`/org/${slug}/events/${eventId}/${section.href}`}
            className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-red-300 hover:shadow-sm transition-all"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-xs font-semibold text-gray-600">
              {section.icon}
            </span>
            <span className="text-sm font-medium text-gray-700">{section.label}</span>
          </Link>
        ))}
      </div>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          {t('organizer.archive.title')}
        </h2>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-gray-600">{t('organizer.archive.description')}</p>
            <Link
              href={`/org/${slug}/events/${eventId}/archive`}
              className="text-sm font-medium text-red-700 hover:underline flex-shrink-0"
            >
              {t('organizer.archive.open')}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
