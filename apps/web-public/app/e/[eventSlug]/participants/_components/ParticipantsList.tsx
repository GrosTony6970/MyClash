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
      <div className="sticky top-0 z-10 -mx-4 bg-stone-50/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-stone-50/80 sm:mx-0 sm:rounded-md">
        <label htmlFor="participants-search" className="sr-only">
          Search participants
        </label>
        <input
          id="participants-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or club…"
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30 sm:max-w-md"
          aria-label="Search participants by name or club"
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-stone-100 p-6 text-center text-sm text-slate-500">
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
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <Link
                  href={`/e/${eventSlug}/people/${p.personId}`}
                  className="text-base font-semibold text-slate-900 hover:text-red-700"
                >
                  {p.displayName}
                </Link>
                {(p.clubName || p.clubAbbrev) && (
                  <p className="mt-1 text-xs text-slate-500">
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
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-stone-300 bg-stone-100 text-slate-500 opacity-60',
                          ].join(' ')}
                        >
                          {t.name}
                          {t.registrationState === 'waitlist' && (
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
                <tr className="border-b border-stone-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
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
                  <tr key={p.personId} className="border-b border-stone-100">
                    <th scope="row" className="py-3 pr-4 text-left">
                      <Link
                        href={`/e/${eventSlug}/people/${p.personId}`}
                        className="font-semibold text-slate-900 hover:text-red-700"
                      >
                        {p.displayName}
                      </Link>
                    </th>
                    <td className="py-3 pr-4 text-slate-600">
                      {p.clubAbbrev && (
                        <span className="mr-1 rounded bg-stone-100 px-1.5 py-px font-mono text-[10px] text-slate-700">
                          {p.clubAbbrev}
                        </span>
                      )}
                      {p.clubName ?? '—'}
                    </td>
                    <td className="py-3 pr-4">
                      {p.tournaments.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1">
                          {p.tournaments.map((t) => (
                            <li key={t.id}>
                              <Link
                                href={`/e/${eventSlug}/t/${encodeURIComponent(t.slug)}`}
                                className={[
                                  'inline-block rounded-full border px-2 py-0.5 text-xs',
                                  t.registrationState === 'active'
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                    : 'border-stone-300 bg-stone-100 text-slate-500 opacity-60',
                                ].join(' ')}
                              >
                                {t.name}
                                {t.registrationState === 'waitlist' && (
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

      <p className="text-xs text-slate-500">
        {visible.length} of {participants.length} participants
      </p>
    </div>
  );
}
