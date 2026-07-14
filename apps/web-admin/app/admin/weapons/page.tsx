'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AdminPageHeader,
  ConfirmDialog,
  PromptDialog,
  RowActionButton,
  useToast,
} from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';

interface WeaponRow {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  usageCount: number;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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

    fetch(`${apiUrl}/api/v1/admin/weapons`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as WeaponRow[];
      })
      .then((rows) => {
        if (cancelled) return;
        setWeapons(rows);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setError(t('admin.weapons.loadError'));
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
      const res = await fetch(`${apiUrl}/api/v1/admin/weapons`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.status === 409) {
        toast.error(t('admin.weapons.duplicateError'));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t('admin.weapons.created'));
      setAddOpen(false);
      refresh();
    } catch {
      toast.error(t('admin.common.somethingWentWrong'));
    } finally {
      setActionBusy(false);
    }
  }

  async function renameWeapon(id: string, name: string) {
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/weapons/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t('admin.weapons.updated'));
      setRenameTarget(null);
      refresh();
    } catch {
      toast.error(t('admin.common.somethingWentWrong'));
    } finally {
      setActionBusy(false);
    }
  }

  async function toggleActive(row: WeaponRow) {
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/weapons/${row.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !row.active }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t('admin.weapons.updated'));
      refresh();
    } catch {
      toast.error(t('admin.common.somethingWentWrong'));
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteWeapon(id: string) {
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/weapons/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) throw new Error(String(res.status));
      toast.success(t('admin.weapons.deleted'));
      setDeleteTarget(null);
      refresh();
    } catch {
      toast.error(t('admin.common.somethingWentWrong'));
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
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left">
            <thead className="bg-background text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">{t('admin.weapons.nameHeader')}</th>
                <th className="px-4 py-3 font-semibold">{t('admin.weapons.slugHeader')}</th>
                <th className="px-4 py-3 font-semibold">{t('admin.weapons.statusHeader')}</th>
                <th className="px-4 py-3 font-semibold">{t('admin.weapons.usageHeader')}</th>
                <th className="px-4 py-3 text-right font-semibold">
                  {t('admin.weapons.actionsHeader')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {weapons.map((w) => (
                <tr key={w.id} className="text-sm text-foreground">
                  <td className="px-4 py-3 font-medium">{w.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{w.slug}</td>
                  <td className="px-4 py-3">
                    {w.active ? (
                      <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                        {t('admin.weapons.active')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted/15 px-2 py-0.5 text-xs font-semibold text-muted">
                        {t('admin.weapons.inactive')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{w.usageCount}</td>
                  <td className="px-4 py-3">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
