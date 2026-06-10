'use client';

/**
 * Per-tournament participants tab. Two sub-tabs:
 *   - Main list — active registrations (registered + checked_in)
 *   - Waiting list — status='waitlist' rows ordered by waitlist_position.
 *     Sub-tab hidden when waitlist is empty.
 *
 * Renders an admin-persons-style table (Name · Club · Referee · Rating) with
 * sortable headers + a search box. Referee = also a referee for this event;
 * Rating = HEMA rating (weighted · rank) for this tournament's weapon.
 */

import { useMemo, useState } from 'react';
import { SkillBadge } from '@myclash/ui';
import { t } from '@myclash/i18n';
import {
  filterParticipants,
  sortParticipants,
  type SortDir,
  type SortKey,
} from './participants-table';

export interface ParticipantsTabEntry {
  personId: string;
  displayName: string;
  clubName: string | null;
  clubAbbrev: string | null;
  registrationState: 'active' | 'waitlist';
  waitlistPosition: number | null;
  /** Also a referee for this event. */
  isReferee: boolean;
  /** HEMA rating for this tournament's weapon (weighted + rank), if resolved. */
  hemaRating: { weightedRating: number; rank: number | null } | null;
}

interface Props {
  entries: ParticipantsTabEntry[];
}

function formatRating(r: { weightedRating: number; rank: number | null } | null): string {
  if (!r) return '—';
  const base = String(Math.round(r.weightedRating));
  return r.rank ? `${base} · #${r.rank}` : base;
}

export function ParticipantsTab({ entries }: Props) {
  const [sub, setSub] = useState<'main' | 'waitlist'>('main');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const mainAll = entries.filter((e) => e.registrationState === 'active');
  const waitAll = entries.filter((e) => e.registrationState === 'waitlist');
  const hasWaitlist = waitAll.length > 0;

  const mainList = useMemo(
    () => sortParticipants(filterParticipants(mainAll, query), sortKey, sortDir),
    [mainAll, query, sortKey, sortDir],
  );
  const waitlist = useMemo(
    () =>
      filterParticipants(waitAll, query).sort(
        (a, b) => (a.waitlistPosition ?? 9999) - (b.waitlistPosition ?? 9999),
      ),
    [waitAll, query],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

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
          {t('publicApp.tournament.participants.mainList')}{' '}
          <span className="ml-1 text-xs text-slate-400">{`(${mainAll.length})`}</span>
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
            {t('publicApp.tournament.participants.waitingList')}{' '}
            <span className="ml-1 text-xs text-amber-700">{`(${waitAll.length})`}</span>
          </button>
        )}
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('publicApp.tournament.participants.search')}
        className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200"
      />

      {sub === 'main' ? (
        <ParticipantsTable
          rows={mainList}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
          emptyLabel={t('publicApp.tournament.participants.emptyMain')}
        />
      ) : (
        <ParticipantsTable
          rows={waitlist}
          showPosition
          emptyLabel={t('publicApp.tournament.participants.emptyWaitlist')}
        />
      )}
    </div>
  );
}

function ParticipantsTable({
  rows,
  showPosition,
  sortKey,
  sortDir,
  onSort,
  emptyLabel,
}: {
  rows: ParticipantsTabEntry[];
  showPosition?: boolean;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSort?: (key: SortKey) => void;
  emptyLabel: string;
}) {
  const colSpan = showPosition ? 5 : 4;
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wider text-slate-500">
            {showPosition && <th className="w-12 px-4 py-2 text-center">{'#'}</th>}
            <SortableTh
              label={t('publicApp.tournament.participants.colName')}
              col="name"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableTh
              label={t('publicApp.tournament.participants.colClub')}
              col="club"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <th className="px-4 py-2">{t('publicApp.tournament.participants.colReferee')}</th>
            <SortableTh
              label={t('publicApp.tournament.participants.colRating')}
              col="rating"
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-6 text-center text-sm italic text-slate-500">
                {emptyLabel}
              </td>
            </tr>
          )}
          {rows.map((e) => (
            <tr
              key={e.personId}
              className="border-b border-stone-100 last:border-0 hover:bg-stone-50"
            >
              {showPosition && (
                <td className="px-4 py-2 text-center font-mono text-xs tabular-nums text-amber-800">
                  {e.waitlistPosition ?? '—'}
                </td>
              )}
              <td className="px-4 py-2 font-semibold text-slate-900">{e.displayName}</td>
              <td className="px-4 py-2 text-slate-500">{e.clubName ?? e.clubAbbrev ?? '—'}</td>
              <td className="px-4 py-2">
                {e.isReferee && (
                  <SkillBadge
                    color="violet"
                    label={t('publicApp.tournament.participants.refereeBadge')}
                  />
                )}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-700">
                {formatRating(e.hemaRating)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  label,
  col,
  align,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  align?: 'right';
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSort?: (key: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th className={`px-4 py-2 ${align === 'right' ? 'text-right' : ''}`}>
      {onSort ? (
        <button
          type="button"
          onClick={() => onSort(col)}
          className="inline-flex items-center gap-1 font-medium uppercase tracking-wider hover:text-slate-700"
        >
          {label}
          {active && <span aria-hidden="true">{sortDir === 'asc' ? '▲' : '▼'}</span>}
        </button>
      ) : (
        label
      )}
    </th>
  );
}
