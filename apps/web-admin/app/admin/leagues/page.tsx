'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminPageHeader,
  ConfirmDialog,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  RowActionButton,
  SortableHeader,
  rowActionClasses,
  useSortableList,
  useToast,
} from '@myclash/ui';
import { t } from '@myclash/i18n';

interface League {
  id: string;
  slug: string;
  name: string;
  season_year: number;
  status: string;
  public_visibility: boolean;
  logo_url: string | null;
  scoring_system: string;
  scoring_config: {
    scoringSystem?: 'ffamhe_tf_2026' | 'custom';
    rankingDimensions?: 'weapon' | 'weapon_category';
  } | null;
  // Projected by the BE's listManageable enrichment (Slice 3).
  // The "Ranking" tab surfaces these as summary columns; the
  // existing "League list" tab ignores them.
  event_count?: number;
  tournament_count?: number;
  group_count?: number;
  fighter_count?: number;
}

type AdminLeaguesTab = 'list' | 'ranking';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatScoringSystem(value: string): string {
  if (value === 'ffamhe_tf_2026') return 'FFAMHE TF 2026';
  if (value === 'custom') return 'Custom';
  return value;
}

function formatCategory(value: string | undefined): string {
  if (value === 'weapon') return 'Weapon';
  if (value === 'weapon_category') return 'Weapon + Group';
  return '—';
}

export default function AdminLeaguesPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminLeaguesTab>('list');

  const fetchLeagues = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch(`${apiUrl}/api/v1/admin/leagues`, {
      credentials: 'include',
      signal,
    });
    if (!res.ok) throw new Error(t('admin.common.loadLeaguesFailed'));
    return (await res.json()) as League[];
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchLeagues(controller.signal)
      .then((data) => {
        setLeagues(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('admin.common.loadLeaguesFailed'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [fetchLeagues]);

  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<League | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const league = pendingDelete;
    setBusyId(league.id);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${league.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.common.deleteFailed'));
      }
      setLeagues((prev) => prev.filter((l) => l.id !== league.id));
      toast.success(t('admin.adminLeagues.toastDeleted', { name: league.name }));
      setPendingDelete(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('admin.common.deleteFailed');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function changeStatus(league: League, status: string) {
    if (status === league.status) return;
    setBusyId(league.id);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${league.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.common.updateFailed'));
      }
      setLeagues((prev) => prev.map((l) => (l.id === league.id ? { ...l, status } : l)));
      toast.success(t('admin.adminLeagues.statusUpdated'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('admin.common.updateFailed');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  const getLeagueSortValue = useCallback((row: League, key: string): unknown => {
    switch (key) {
      case 'name':
        return row.name;
      case 'year':
        return row.season_year;
      case 'category':
        return row.scoring_config?.rankingDimensions ?? '';
      case 'scoringSystem':
        return formatScoringSystem(row.scoring_system);
      case 'status':
        return row.status;
      default:
        return null;
    }
  }, []);
  const {
    sorted: visibleLeagues,
    sortKey,
    direction,
    toggle,
  } = useSortableList(leagues, getLeagueSortValue);

  return (
    <main id="main-content" className="mx-auto w-full max-w-[110rem] px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Leagues"
        title={t('admin.adminLeagues.pageTitle')}
        subtitle="Manage league setup, scoring, member orgs, and linked tournaments."
        actions={
          <Link
            href="/admin/leagues/new"
            className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover"
          >
            {t('admin.adminLeagues.createButton')}
          </Link>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-4 inline-flex rounded-md border border-border bg-surface p-1 shadow-sm">
        {(
          [
            ['list', 'League list'],
            ['ranking', 'Ranking'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={[
              'rounded px-3 py-1.5 text-sm font-semibold transition-colors',
              tab === value
                ? 'bg-accent text-white'
                : 'text-foreground-secondary hover:bg-background',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'ranking' && (
        <DataTable className="min-w-[820px]">
          <DataTableHead>
            <DataTableCell as="th" className="w-16">
              {t('admin.adminLeagues.colLogo')}
            </DataTableCell>
            <DataTableCell as="th">{t('admin.adminLeagues.colName')}</DataTableCell>
            <DataTableCell as="th">{t('admin.adminLeagues.colYear')}</DataTableCell>
            <DataTableCell as="th" className="text-center">
              {t('admin.adminLeagues.colEvents')}
            </DataTableCell>
            <DataTableCell as="th" className="text-center">
              {t('admin.adminLeagues.colTournaments')}
            </DataTableCell>
            <DataTableCell as="th" className="text-center">
              {t('admin.adminLeagues.colGroups')}
            </DataTableCell>
            <DataTableCell as="th" className="text-center">
              {t('admin.adminLeagues.colFighters')}
            </DataTableCell>
          </DataTableHead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-muted">
                  {t('admin.adminLeagues.loading')}
                </td>
              </tr>
            )}
            {!loading && leagues.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-sm text-muted">
                  {t('admin.adminLeagues.noLeaguesYet')}
                </td>
              </tr>
            )}
            {leagues.map((league) => (
              <DataTableRow key={league.id}>
                <DataTableCell>
                  {league.logo_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={league.logo_url}
                      alt={league.name}
                      className="h-9 w-9 rounded-md border border-border bg-surface object-contain"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-[11px] font-semibold text-muted">
                      {initialsFor(league.name)}
                    </div>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <Link
                    href={`/admin/leagues/${league.id}/ranking`}
                    className="font-medium text-accent hover:underline"
                  >
                    {league.name}
                  </Link>
                  <p className="mt-0.5 font-mono text-xs text-muted">/{league.slug}</p>
                </DataTableCell>
                <DataTableCell>{league.season_year}</DataTableCell>
                <DataTableCell className="text-center tabular-nums">
                  {league.event_count ?? 0}
                </DataTableCell>
                <DataTableCell className="text-center tabular-nums">
                  {league.tournament_count ?? 0}
                </DataTableCell>
                <DataTableCell className="text-center tabular-nums">
                  {league.group_count ?? 0}
                </DataTableCell>
                <DataTableCell className="text-center tabular-nums">
                  {league.fighter_count ?? 0}
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}

      {tab === 'list' && (
        <DataTable className="min-w-[920px]">
          <DataTableHead>
            <DataTableCell as="th" className="w-16">
              {t('admin.adminLeagues.colLogo')}
            </DataTableCell>
            <DataTableCell as="th">
              <SortableHeader
                label={t('admin.adminLeagues.colName')}
                columnKey="name"
                currentKey={sortKey}
                direction={direction}
                onToggle={toggle}
                ariaSortAsc={t('admin.common.sortAscLabel')}
                ariaSortDesc={t('admin.common.sortDescLabel')}
              />
            </DataTableCell>
            <DataTableCell as="th">
              <SortableHeader
                label={t('admin.adminLeagues.colYear')}
                columnKey="year"
                currentKey={sortKey}
                direction={direction}
                onToggle={toggle}
                ariaSortAsc={t('admin.common.sortAscLabel')}
                ariaSortDesc={t('admin.common.sortDescLabel')}
              />
            </DataTableCell>
            <DataTableCell as="th">
              <SortableHeader
                label={t('admin.adminLeagues.colGrouping')}
                columnKey="category"
                currentKey={sortKey}
                direction={direction}
                onToggle={toggle}
                ariaSortAsc={t('admin.common.sortAscLabel')}
                ariaSortDesc={t('admin.common.sortDescLabel')}
              />
            </DataTableCell>
            <DataTableCell as="th">
              <SortableHeader
                label={t('admin.adminLeagues.colScoringSystem')}
                columnKey="scoringSystem"
                currentKey={sortKey}
                direction={direction}
                onToggle={toggle}
                ariaSortAsc={t('admin.common.sortAscLabel')}
                ariaSortDesc={t('admin.common.sortDescLabel')}
              />
            </DataTableCell>
            <DataTableCell as="th">
              <SortableHeader
                label={t('admin.adminLeagues.colStatus')}
                columnKey="status"
                currentKey={sortKey}
                direction={direction}
                onToggle={toggle}
                ariaSortAsc={t('admin.common.sortAscLabel')}
                ariaSortDesc={t('admin.common.sortDescLabel')}
              />
            </DataTableCell>
            <DataTableCell as="th">{t('admin.adminLeagues.colPublic')}</DataTableCell>
            <DataTableCell as="th">{t('admin.adminLeagues.colActions')}</DataTableCell>
          </DataTableHead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-muted">
                  {t('admin.adminLeagues.loading')}
                </td>
              </tr>
            )}
            {!loading && leagues.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-sm text-muted">
                  {t('admin.adminLeagues.emptyHintBefore')}{' '}
                  <strong>{t('admin.adminLeagues.emptyHintAction')}</strong>{' '}
                  {t('admin.adminLeagues.emptyHintAfter')}
                </td>
              </tr>
            )}
            {visibleLeagues.map((league) => (
              <DataTableRow key={league.id}>
                <DataTableCell>
                  {league.logo_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={league.logo_url}
                      alt={league.name}
                      className="h-9 w-9 rounded-md border border-border bg-surface object-contain"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-[11px] font-semibold text-muted">
                      {initialsFor(league.name)}
                    </div>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <p className="font-medium text-foreground">{league.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted">/{league.slug}</p>
                </DataTableCell>
                <DataTableCell>{league.season_year}</DataTableCell>
                <DataTableCell>
                  {formatCategory(league.scoring_config?.rankingDimensions)}
                </DataTableCell>
                <DataTableCell>{formatScoringSystem(league.scoring_system)}</DataTableCell>
                <DataTableCell>
                  <select
                    aria-label={t('admin.adminLeagues.colStatus')}
                    value={league.status}
                    disabled={busyId === league.id}
                    onChange={(e) => void changeStatus(league, e.target.value)}
                    className={[
                      'cursor-pointer rounded-full border border-border px-2 py-0.5 text-xs font-semibold',
                      league.status === 'published'
                        ? 'bg-success/10 text-success'
                        : league.status === 'archived'
                          ? 'bg-background text-foreground-secondary'
                          : 'bg-warning/10 text-warning',
                    ].join(' ')}
                  >
                    <option value="draft">{t('admin.adminLeagues.statusDraft')}</option>
                    <option value="published">{t('admin.adminLeagues.statusPublished')}</option>
                    <option value="archived">{t('admin.adminLeagues.statusArchived')}</option>
                  </select>
                </DataTableCell>
                <DataTableCell>{league.public_visibility ? 'Yes' : 'No'}</DataTableCell>
                <DataTableCell>
                  <div className="flex gap-2">
                    <Link
                      href={`/admin/leagues/${league.id}/edit`}
                      className={rowActionClasses('edit')}
                    >
                      {t('admin.adminLeagues.editAction')}
                    </Link>
                    <RowActionButton
                      variant="danger"
                      onClick={() => setPendingDelete(league)}
                      disabled={busyId === league.id}
                    >
                      {t('admin.adminLeagues.deleteAction')}
                    </RowActionButton>
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('admin.adminLeagues.deleteDialogTitle')}
        description={
          pendingDelete ? `Delete league "${pendingDelete.name}"? This cannot be undone.` : ''
        }
        confirmLabel="Delete"
        danger
        busy={busyId === pendingDelete?.id}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </main>
  );
}
