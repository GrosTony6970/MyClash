/**
 * PublicHome — T-604
 * Persona: public (default)
 *
 * Shows: editorial/event intro, schedule highlights.
 */

import Link from 'next/link';

interface EventInfo {
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  publicLandingMd: string | null;
  status: string;
}

interface HighlightMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  liceName: string | null;
  tournamentName: string | null;
}

interface Props {
  eventSlug: string;
  apiUrl: string;
}

async function fetchEventInfo(eventSlug: string, apiUrl: string): Promise<EventInfo | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/slug/${encodeURIComponent(eventSlug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as EventInfo;
  } catch {
    return null;
  }
}

async function fetchHighlights(eventSlug: string, apiUrl: string): Promise<HighlightMatch[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/highlights`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as HighlightMatch[];
  } catch {
    return [];
  }
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })} – ${e.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
  }
  if (s.getMonth() !== e.getMonth()) {
    return `${s.toLocaleDateString('fr-FR', opts)} – ${e.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
  }
  return `${s.getDate()}–${e.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
}

export async function PublicHome({ eventSlug, apiUrl }: Props) {
  const [event, highlights] = await Promise.all([
    fetchEventInfo(eventSlug, apiUrl),
    fetchHighlights(eventSlug, apiUrl),
  ]);

  const live = highlights.filter((m) => m.status === 'running');
  const upcoming = highlights.filter((m) => m.status === 'scheduled').slice(0, 5);

  return (
    <main className="flex flex-col gap-8 px-4 py-6 max-w-lg mx-auto">
      {/* Event intro */}
      {event && (
        <section>
          <h1
            className="text-3xl font-bold mb-1"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
          >
            {event.name}
          </h1>
          {event.location && <p className="text-gray-400 text-sm">{event.location}</p>}
          <p className="text-gray-500 text-sm mt-0.5">
            {formatDateRange(event.startDate, event.endDate)}
          </p>

          {/* Status badge */}
          {event.status === 'running' && (
            <span className="inline-flex items-center gap-1.5 mt-3 text-xs font-bold px-3 py-1 rounded-full bg-red-900 text-red-300">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              Event in progress
            </span>
          )}

          {/* Editorial / landing markdown */}
          {event.publicLandingMd && (
            <div className="mt-4 text-gray-300 text-sm leading-relaxed prose prose-invert prose-sm max-w-none">
              {/* Render as plain text — full markdown rendering is T-606+ */}
              <p>{event.publicLandingMd}</p>
            </div>
          )}
        </section>
      )}

      {/* Live matches */}
      {live.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
            style={{ color: 'var(--event-primary, #c0392b)' }}
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
            Live now
          </h2>
          <div className="flex flex-col gap-3">
            {live.map((m) => (
              <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                <div
                  className="rounded-xl border-2 p-4"
                  style={{ borderColor: 'var(--event-primary, #c0392b)' }}
                >
                  <p className="text-xs text-gray-400 mb-2">
                    {m.tournamentName} · {m.matchNumberLabel}
                    {m.liceName && ` · ${m.liceName}`}
                  </p>
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-white">{m.redFighterName ?? '?'}</p>
                    <p className="text-2xl font-black tabular-nums">
                      <span style={{ color: 'var(--event-primary, #c0392b)' }}>{m.redScore}</span>
                      <span className="text-gray-600 mx-1.5">–</span>
                      <span style={{ color: 'var(--color-blue-400, #60a5fa)' }}>{m.blueScore}</span>
                    </p>
                    <p className="font-bold text-white">{m.blueFighterName ?? '?'}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Schedule highlights */}
      {upcoming.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            Schedule highlights
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-600 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {m.redFighterName ?? '?'} vs {m.blueFighterName ?? '?'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {m.tournamentName} · {m.matchNumberLabel}
                    </p>
                  </div>
                  {m.scheduledAt && (
                    <p className="text-sm text-gray-400">
                      {new Date(m.scheduledAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CTA: onboarding */}
      <section className="border-t border-gray-800 pt-6">
        <p className="text-sm text-gray-500 mb-3">
          Are you a participant? Find yourself in the list to get a personalised view.
        </p>
        <Link
          href={`/e/${eventSlug}/onboarding`}
          className="inline-block px-5 py-2.5 rounded-xl font-semibold text-white text-sm transition-colors"
          style={{ backgroundColor: 'var(--event-primary, #c0392b)' }}
        >
          I&apos;m a participant →
        </Link>
      </section>
    </main>
  );
}
