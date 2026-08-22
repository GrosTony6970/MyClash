'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AdminPageHeader,
  ConfirmDialog,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  PromptDialog,
  RowActionButton,
  useToast,
} from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

interface WeaponRow {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  usageCount: number;
}

const apiUrl = getPublicApiUrl();

export default function AdminWeaponsPage() {
  const { t } = useI18n();
  const toast = useToast();

  const [weapons, setWeapons] = useState<WeaponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WeaponRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WeaponRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void apiRequest<WeaponRow[]>(apiUrl, '/api/v1/admin/weapons', {
      signal: controller.signal,
    })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setWeapons(r.data);
          setError(null);
          return;
        }
        // No message is the unmount, or the refresh that replaced this read.
        const message = failureMessage(r, t, t('admin.weapons.loadError'));
        if (message) setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshKey, t]);

  async function createWeapon(name: string) {
    setActionBusy(true);
    try {
      const r = await apiRequest(apiUrl, '/api/v1/admin/weapons', {
        method: 'POST',
        body: { name },
      });
      if (!r.ok) {
        // A name already in the catalogue comes back 409, and that case keeps a
        // fallback of its own for the server that gives no reason. Every other
        // refusal used to read "Something went wrong."
        const fallback =
          r.kind === 'http' && r.status === 409
            ? t('admin.weapons.duplicateError')
            : t('admin.common.somethingWentWrong');
        const message = failureMessage(r, t, fallback);
        if (message) toast.error(message);
        return;
      }
      toast.success(t('admin.weapons.created'));
      setAddOpen(false);
      refresh();
    } finally {
      setActionBusy(false);
    }
  }

  async function renameWeapon(id: string, name: string) {
    setActionBusy(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/admin/weapons/${id}`, {
        method: 'PATCH',
        body: { name },
      });
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.somethingWentWrong'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('admin.weapons.updated'));
      setRenameTarget(null);
      refresh();
    } finally {
      setActionBusy(false);
    }
  }

  async function toggleActive(row: WeaponRow) {
    setActionBusy(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/admin/weapons/${row.id}`, {
        method: 'PATCH',
        body: { active: !row.active },
      });
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.somethingWentWrong'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('admin.weapons.updated'));
      refresh();
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteWeapon(id: string) {
    setActionBusy(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/admin/weapons/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        // A weapon a tournament still uses is refused by name. That sentence
        // used to be replaced by "Something went wrong."
        const message = failureMessage(r, t, t('admin.common.somethingWentWrong'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('admin.weapons.deleted'));
      setDeleteTarget(null);
      refresh();
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.weapons.eyebrow')}
        title={t('admin.weapons.title')}
        subtitle={t('admin.weapons.subtitle')}
        actions={
          <RowActionButton variant="success" onClick={() => setAddOpen(true)}>
            {t('admin.weapons.addButton')}
          </RowActionButton>
        }
      />

      {error ? (
        <p className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : weapons.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.weapons.empty')}</p>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">{t('admin.weapons.nameHeader')}</DataTableCell>
            <DataTableCell as="th">{t('admin.weapons.slugHeader')}</DataTableCell>
            <DataTableCell as="th">{t('admin.weapons.statusHeader')}</DataTableCell>
            <DataTableCell as="th">{t('admin.weapons.usageHeader')}</DataTableCell>
            <DataTableCell as="th" className="text-right">
              {t('admin.weapons.actionsHeader')}
            </DataTableCell>
          </DataTableHead>
          <tbody>
            {weapons.map((w) => (
              <DataTableRow key={w.id}>
                <DataTableCell className="font-medium text-foreground">{w.name}</DataTableCell>
                <DataTableCell mono>{w.slug}</DataTableCell>
                <DataTableCell>
                  {w.active ? (
                    <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                      {t('admin.weapons.active')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-muted/15 px-2 py-0.5 text-xs font-semibold text-muted">
                      {t('admin.weapons.inactive')}
                    </span>
                  )}
                </DataTableCell>
                <DataTableCell className="tabular-nums">{w.usageCount}</DataTableCell>
                <DataTableCell>
                  <div className="flex justify-end gap-2">
                    <RowActionButton
                      variant="edit"
                      disabled={actionBusy}
                      onClick={() => setRenameTarget(w)}
                    >
                      {t('admin.weapons.rename')}
                    </RowActionButton>
                    <RowActionButton
                      variant={w.active ? 'warning' : 'success'}
                      disabled={actionBusy}
                      onClick={() => void toggleActive(w)}
                    >
                      {w.active ? t('admin.weapons.deactivate') : t('admin.weapons.activate')}
                    </RowActionButton>
                    <RowActionButton
                      variant="danger"
                      disabled={actionBusy}
                      onClick={() => setDeleteTarget(w)}
                    >
                      {t('admin.weapons.delete')}
                    </RowActionButton>
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}

      <PromptDialog
        open={addOpen}
        title={t('admin.weapons.addTitle')}
        placeholder={t('admin.weapons.addPlaceholder')}
        confirmLabel={t('admin.weapons.addButton')}
        cancelLabel={t('admin.weapons.cancel')}
        busy={actionBusy}
        onConfirm={(v) => void createWeapon(v.trim())}
        onCancel={() => setAddOpen(false)}
      />

      <PromptDialog
        open={renameTarget !== null}
        title={t('admin.weapons.renameTitle')}
        initialValue={renameTarget?.name ?? ''}
        confirmLabel={t('admin.weapons.rename')}
        cancelLabel={t('admin.weapons.cancel')}
        busy={actionBusy}
        onConfirm={(v) => {
          if (renameTarget) void renameWeapon(renameTarget.id, v.trim());
        }}
        onCancel={() => setRenameTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        danger
        title={t('admin.weapons.deleteTitle')}
        description={t('admin.weapons.deleteBody', {
          name: deleteTarget?.name ?? '',
          count: String(deleteTarget?.usageCount ?? 0),
        })}
        confirmLabel={t('admin.weapons.delete')}
        cancelLabel={t('admin.weapons.cancel')}
        busy={actionBusy}
        onConfirm={() => {
          if (deleteTarget) void deleteWeapon(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </main>
  );
}
