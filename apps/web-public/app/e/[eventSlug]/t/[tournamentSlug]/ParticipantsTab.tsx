'use client';

/**
 * Per-tournament participants tab. Two sub-tabs:
 *   - Main list — active registrations (registered + checked_in)
 *   - Waiting list — status='waitlist' rows ordered by
 *     waitlist_position. Sub-tab hidden when waitlist is empty.
 *
 * Both lists scoped to THIS tournament (not the whole event roster).
 * Renders a flat sortable list per sub-tab; no fancy filtering at v1.
 */

import { useState } from 'react';

export interface ParticipantsTabEntry {
  personId: string;
  displayName: string;
  clubName: string | null;
  clubAbbrev: string | null;
  registrationState: 'active' | 'waitlist';
  waitlistPosition: number | null;
}

interface Props {
  entries: ParticipantsTabEntry[];
}

export function ParticipantsTab({ entries }: Props) {
  const mainList = entries.filter((e) => e.registrationState === 'active');
  const waitlist = entries
    .filter((e) => e.registrationState === 'waitlist')
    .sort((a, b) => (a.waitlistPosition ?? 9999) - (b.waitlistPosition ?? 9999));

  const [sub, setSub] = useState<'main' | 'waitlist'>('main');
  const hasWaitlist = waitlist.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-1 border-b border-stone-200">
        <button
          type="button"
          role="tab"
          aria-selected={sub === 'main'}
          onClick={() => setSub('main')}
          className={
            'rounded-t-lg px-3 py-1.5 text-sm font-semibold ' +
            (sub === 'main'
              ? 'border-x border-t border-stone-200 bg-white text-slate-900'
              : 'text-slate-500 hover:text-slate-700')
          }
        >
          Main list <span className="ml-1 text-xs text-slate-400">({mainList.length})</span>
        </button>
        {hasWaitlist && (
          <button
            type="button"
            role="tab"
            aria-selected={sub === 'waitlist'}
            onClick={() => setSub('waitlist')}
            className={
              'rounded-t-lg px-3 py-1.5 text-sm font-semibold ' +
              (sub === 'waitlist'
                ? 'border-x border-t border-stone-200 bg-white text-slate-900'
                : 'text-slate-500 hover:text-slate-700')
            }
          >
            Waiting list <span className="ml-1 text-xs text-amber-700">({waitlist.length})</span>
          </button>
        )}
      </div>

      {sub === 'main' && (
        <ul className="space-y-1">
          {mainList.length === 0 && (
            <li className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
              No participants registered yet.
            </li>
          )}
          {mainList.map((e) => (
            <li
              key={e.personId}
              className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-2"
            >
              <span className="font-semibold text-slate-900 truncate">{e.displayName}</span>
              {e.clubName && <span className="text-xs text-slate-500 truncate">{e.clubName}</span>}
            </li>
          ))}
        </ul>
      )}

      {sub === 'waitlist' && hasWaitlist && (
        <ol className="space-y-1">
          {waitlist.map((e) => (
            <li
              key={e.personId}
              className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-2"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-sm font-bold tabular-nums text-amber-800">
                {e.waitlistPosition ?? '—'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 truncate">{e.displayName}</p>
                {e.clubName && <p className="text-xs text-slate-500 truncate">{e.clubName}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
