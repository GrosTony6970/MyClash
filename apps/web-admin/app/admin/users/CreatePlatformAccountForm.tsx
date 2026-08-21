'use client';

import { useState, type FormEvent } from 'react';
import type { PlatformRole } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { apiRequest } from '@myclash/api-client';
import { readError, roleLabelKey } from './types';

interface CreateUserResponse {
  user: { id: string; email: string; created: boolean };
  temporaryPassword: string;
  platformRole: PlatformRole | null;
}

/**
 * Create a confirmed account with a one-time password.
 *
 * Lives on the Platform tab because that is where a created account lands: it
 * has no organisation and, if a tier is picked, a platform_roles row. The old
 * page had to force the listing to "show all logins" after a create to keep
 * the new row visible; scoping the tabs makes that hack unnecessary.
 */
export function CreatePlatformAccountForm({ onCreated }: { onCreated: () => void }) {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<PlatformRole | ''>('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateUserResponse | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setResult(null);

    const r = await apiRequest<CreateUserResponse>(apiUrl, '/api/v1/admin/users', {
      method: 'POST',
      body: {
        email,
        displayName: displayName || undefined,
        platformRole: role || undefined,
      },
    });

    setCreating(false);
    if (!r.ok) {
      // The 429 sentence used to be picked here; `failureMessage` owns it now.
      const message = readError(r, t, t('admin.users.create.failed'));
      if (message) setError(message);
      return;
    }

    setResult(r.data);
    setEmail('');
    setDisplayName('');
    setRole('');
    onCreated();
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground sm:text-xl">
        {t('admin.users.create.title')}
      </h2>
      <p className="mt-1 text-sm text-foreground-secondary">
        {t('admin.users.create.description')}
      </p>

      <form
        className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end"
        onSubmit={(event) => {
          void handleCreate(event);
        }}
      >
        <label className="grid gap-1 text-sm font-medium text-foreground-secondary">
          {t('admin.users.create.email')}
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-foreground-secondary">
          {t('admin.users.create.displayName')}
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground"
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-info px-4 py-2 text-sm font-semibold text-white hover:bg-info/90 disabled:opacity-60"
        >
          {creating ? t('admin.users.create.submitting') : t('admin.users.create.submit')}
        </button>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground-secondary lg:col-span-3">
          {t('admin.users.create.platformRole')}
          {/*
            A four-way selector, not a super-admin checkbox: the tiers are
            mutually exclusive, so a set of checkboxes could express states the
            platform_roles primary key cannot store.
          */}
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as PlatformRole | '')}
            className="max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">{t('admin.users.role.none')}</option>
            <option value="platform_viewer">{t('admin.users.role.platformViewer')}</option>
            <option value="platform_admin">{t('admin.users.role.platformAdmin')}</option>
            <option value="super_admin">{t('admin.users.role.superAdmin')}</option>
          </select>
        </label>
      </form>

      {error && (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-semibold">{t('admin.users.create.success')}</p>
          <p>
            {t('admin.users.create.loginEmail')}: {result.user.email}
          </p>
          <p className="font-mono">
            {t('admin.users.create.temporaryPassword')}: {result.temporaryPassword}
          </p>
          {result.platformRole && (
            <p>
              {t('admin.users.create.roleGranted').replace(
                '{role}',
                t(roleLabelKey(result.platformRole)),
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
