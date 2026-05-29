'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { filterParticipants, type ParticipantLike } from './filter-participants';

interface Props {
  eventSlug: string;
  participants: ParticipantLike[];
}

export function ParticipantsList({ eventSlug, participants }: Props) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterParticipants(participants, query), [participants, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-4 bg-neutral-950/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/80 sm:mx-0 sm:rounded-md">
        <label htmlFor="participants-search" className="sr-only">
          Search participants
        </label>
        <input
          id="participants-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or club…"
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 sm:max-w-md"
          aria-label="Search participants by name or club"
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
          {query.trim() === ''
            ? 'No participants registered yet.'
            : 'No participant matches that search.'}
        </p>
      ) : (
        <>
          {/* Mobile / narrow: stacked cards. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {visible.map((p) => (
              <li
                key={p.personId}
                className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
              >
                <Link
                  href={`/e/${eventSlug}/people/${p.personId}`}
                  className="text-base font-semibold text-white hover:text-emerald-300"
                >
                  {p.displayName}
                </Link>
                {(p.clubName || p.clubAbbrev) && (
                  <p className="mt-1 text-xs text-neutral-400">
                    {p.clubAbbrev ? `${p.clubAbbrev} · ${p.clubName ?? ''}` : p.clubName}
                  </p>
                )}
                {p.tournaments.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {p.tournaments.map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/e/${eventSlug}/t/${encodeURIComponent(t.slug)}`}
                          className={[
                            'inline-block rounded-full border px-2 py-0.5 text-xs',
                            t.registrationState === 'active'
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                              : 'border-neutral-700 bg-neutral-800 text-neutral-400 opacity-60',
                          ].join(' ')}
                        >
                          {t.name}
                          {t.registrationState === 'pending' && (
                            <span className="ml-1 text-[10px]">· Waitlist</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop: proper table. */}
          <div className="hidden md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  <th scope="col" className="py-2 pr-4">
                    Name
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Club
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Tournaments
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.personId} className="border-b border-neutral-900">
                    <th scope="row" className="py-3 pr-4 text-left">
                      <Link
                        href={`/e/${eventSlug}/people/${p.personId}`}
                        className="font-semibold text-white hover:text-emerald-300"
                      >
                        {p.displayName}
                      </Link>
                    </th>
                    <td className="py-3 pr-4 text-neutral-400">
                      {p.clubAbbrev && (
                        <span className="mr-1 rounded bg-neutral-800 px-1.5 py-px text-[10px] text-neutral-300">
                          {p.clubAbbrev}
                        </span>
                      )}
                      {p.clubName ?? '—'}
                    </td>
                    <td className="py-3 pr-4">
                      {p.tournaments.length === 0 ? (
                        <span className="text-neutral-600">—</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1">
                          {p.tournaments.map((t) => (
                            <li key={t.id}>
                              <Link
                                href={`/e/${eventSlug}/t/${encodeURIComponent(t.slug)}`}
                                className={[
                                  'inline-block rounded-full border px-2 py-0.5 text-xs',
                                  t.registrationState === 'active'
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                                    : 'border-neutral-700 bg-neutral-800 text-neutral-400 opacity-60',
                                ].join(' ')}
                              >
                                {t.name}
                                {t.registrationState === 'pending' && (
                                  <span className="ml-1 text-[10px]">· Waitlist</span>
                                )}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-xs text-neutral-500">
        {visible.length} of {participants.length} participants
      </p>
    </div>
  );
}
