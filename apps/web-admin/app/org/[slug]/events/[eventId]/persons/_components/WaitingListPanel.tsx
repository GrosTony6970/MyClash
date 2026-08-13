'use client';

import { useMemo, useState } from 'react';
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  useConfirm,
  useToast,
} from '@myclash/ui';
import { formatRosterName } from '../roster-name';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * Slice 5 of the tournament capacity + waitlist overhaul.
 *
 * Renders one table per tournament that has a waitlist. Each row
 * supports promote (skip-the-queue) and remove. Drag a row to reorder
 * the queue — the bulk reorder endpoint accepts the full ordered list
 * and rewrites positions 1..N in a single call.
 *
 * Mounted by persons/page.tsx in the new 'Waiting list' mode.
 */

interface PersonLite {
  id: string;
  givenName: string;
  familyName: string;
  clubLabel: string | null;
}

interface WaitlistRegistration {
  id: string;
  personId: string;
  tournamentId: string;
  tournamentName: string;
  waitlistPosition: number | null;
}

interface TournamentLite {
  id: string;
  name: string;
  maxWaitlist?: number | null;
}

interface Props {
  apiUrl: string;
  tournaments: TournamentLite[];
  registrations: WaitlistRegistration[];
  personById: Map<string, PersonLite>;
  onChange: () => void;
}

export function WaitingListPanel({
  apiUrl,
  tournaments,
  registrations,
  personById,
  onChange,
}: Props) {
  const { t: translate } = useI18n();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const grouped = useMemo(() => {
    const map = new Map<string, WaitlistRegistration[]>();
    for (const reg of registrations) {
      if (reg.waitlistPosition == null) continue;
      const list = map.get(reg.tournamentId) ?? [];
      list.push(reg);
      map.set(reg.tournamentId, list);
    }
    for (const list of map.values())
      list.sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));
    return map;
  }, [registrations]);

  async function promote(reg: WaitlistRegistration, force = false) {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/registrations/${reg.id}/promote${force ? '?force=true' : ''}`,
        { method: 'POST', credentials: 'include' },
      );
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { reason?: string } | null;
        if (body?.reason === 'tournament_full') {
          if (await confirm({ title: translate('admin.orgPersons.confirmWaitlistPromoteFull') })) {
            return promote(reg, true);
          }
          return;
        }
      }
      if (!res.ok) throw new Error(translate('admin.common.promoteFailed'));
      toast.success(translate('admin.orgPersons.toastWaitlistPromoted'));
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : translate('admin.common.somethingWentWrong'));
    }
  }

  async function remove(reg: WaitlistRegistration) {
    if (
      !(await confirm({ title: translate('admin.orgPersons.confirmWaitlistRemove'), danger: true }))
    )
      return;
    try {
      const res = await fetch(`${apiUrl}/api/v1/registrations/${reg.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(translate('admin.common.removeFailed'));
      toast.success(translate('admin.orgPersons.toastWaitlistRemoved'));
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : translate('admin.common.somethingWentWrong'));
    }
  }

  async function reorder(tournamentId: string, orderedRegistrationIds: string[]) {
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/waitlist/reorder`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedRegistrationIds }),
      });
      if (!res.ok) throw new Error(translate('admin.common.reorderFailed'));
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : translate('admin.common.somethingWentWrong'));
    }
  }

  if (tournaments.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
        {translate('admin.orgPersons.noTournamentsYet')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {tournaments.map((t) => {
        const rows = grouped.get(t.id) ?? [];
        const max = t.maxWaitlist ?? null;
        return (
          <section key={t.id} className="rounded-lg border border-border bg-surface p-4">
            <header className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display font-semibold text-lg sm:text-xl text-foreground">
                {translate('admin.orgPersons.waitingListHeader', {
                  name: t.name,
                  count: rows.length,
                  max: max ?? '∞',
                })}
              </h3>
            </header>
            {rows.length === 0 ? (
              <p className="text-sm italic text-muted">
                {translate('admin.orgPersons.noOneWaiting')}
              </p>
            ) : (
              <WaitingListTable
                rows={rows}
                personById={personById}
                onPromote={(reg) => void promote(reg)}
                onRemove={(reg) => void remove(reg)}
                onReorder={(orderedIds) => void reorder(t.id, orderedIds)}
              />
            )}
          </section>
        );
      })}
      {confirmDialog}
    </div>
  );
}

function WaitingListTable({
  rows,
  personById,
  onPromote,
  onRemove,
  onReorder,
}: {
  rows: WaitlistRegistration[];
  personById: Map<string, PersonLite>;
  onPromote: (reg: WaitlistRegistration) => void;
  onRemove: (reg: WaitlistRegistration) => void;
  onReorder: (orderedRegistrationIds: string[]) => void;
}) {
  const { t } = useI18n();
  const [dragId, setDragId] = useState<string | null>(null);

  function handleDrop(targetReg: WaitlistRegistration) {
    if (!dragId || dragId === targetReg.id) {
      setDragId(null);
      return;
    }
    const fromIdx = rows.findIndex((r) => r.id === dragId);
    const toIdx = rows.findIndex((r) => r.id === targetReg.id);
    if (fromIdx < 0 || toIdx < 0) {
      setDragId(null);
      return;
    }
    const reordered = [...rows];
    const [moved] = reordered.splice(fromIdx, 1);
    if (moved) reordered.splice(toIdx, 0, moved);
    setDragId(null);
    onReorder(reordered.map((r) => r.id));
  }

  return (
    <DataTable>
      <DataTableHead>
        <DataTableCell as="th" scope="col" className="w-12">
          {t('admin.orgPersons.colPos')}
        </DataTableCell>
        <DataTableCell as="th" scope="col">
          {t('admin.orgPersons.colName')}
        </DataTableCell>
        <DataTableCell as="th" scope="col">
          {t('admin.orgPersons.colClub')}
        </DataTableCell>
        <DataTableCell as="th" scope="col" className="text-right">
          {t('admin.orgPersons.colActions')}
        </DataTableCell>
      </DataTableHead>
      <tbody>
        {rows.map((reg) => {
          const person = personById.get(reg.personId);
          const dragging = dragId === reg.id;
          return (
            <DataTableRow
              key={reg.id}
              draggable
              onDragStart={() => setDragId(reg.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(reg)}
              className={dragging ? 'opacity-40' : ''}
            >
              <DataTableCell className="text-foreground-secondary cursor-grab">
                <span className="mr-1 text-muted" aria-hidden="true">
                  ⋮⋮
                </span>
                {reg.waitlistPosition}
              </DataTableCell>
              <DataTableCell className="font-medium text-foreground">
                {person
                  ? formatRosterName({
                      familyName: person.familyName,
                      givenName: person.givenName,
                    })
                  : reg.personId}
              </DataTableCell>
              <DataTableCell className="text-foreground-secondary">
                {person?.clubLabel ?? '—'}
              </DataTableCell>
              <DataTableCell className="text-right">
                <button
                  type="button"
                  onClick={() => onPromote(reg)}
                  className="mr-2 text-xs font-semibold text-success hover:text-success-hover"
                >
                  {t('admin.orgPersons.promote')}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(reg)}
                  className="text-xs text-danger hover:text-danger-hover"
                >
                  {t('admin.orgPersons.remove')}
                </button>
              </DataTableCell>
            </DataTableRow>
          );
        })}
      </tbody>
    </DataTable>
  );
}
