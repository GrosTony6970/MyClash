'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

const apiUrl = getPublicApiUrl();

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
}

export default function AdminOrgEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const orgId = params.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; slug: string; slugDetached: boolean }>({
    name: '',
    slug: '',
    slugDetached: true,
  });

  useEffect(() => {
    if (!orgId) return;
    const controller = new AbortController();
    void apiRequest<OrgDetail>(apiUrl, `/api/v1/admin/organizations/${orgId}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (r.ok) {
          setForm({ name: r.data.name, slug: r.data.slug, slugDetached: true });
          setError(null);
          return;
        }
        // No message is the unmount.
        const message = failureMessage(r, t, t('admin.organizations.detail.loadError'));
        if (message) setError(message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [orgId, t]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/admin/organizations/${orgId}`, {
        method: 'PATCH',
        body: { name: form.name.trim(), slug: form.slug.trim() },
      });
      if (!r.ok) {
        // No signal on this request, so the abort null cannot arrive here.
        const message = failureMessage(r, t, t('admin.organizations.edit.saveError'));
        if (message) setError(message);
        return;
      }
      router.push('/admin/organizations');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-2xl p-8">
      <BackLink
        href="/admin/organizations"
        label={t('admin.organizations.detail.back')}
        className="mb-2"
      />
      <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-foreground">
        {t('admin.organizations.edit.title')}
      </h1>
      <p className="mb-6 text-sm text-muted">{t('admin.organizations.edit.description')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">{t('admin.organizations.loading')}</p>
      ) : (
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="rounded-md border border-border bg-surface p-5 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-semibold text-foreground-secondary">
              {t('admin.organizations.create.name')}
              <input
                required
                minLength={2}
                maxLength={100}
                value={form.name}
                onChange={(event) => {
                  const name = event.target.value;
                  setForm((current) => ({
                    ...current,
                    name,
                    slug: current.slugDetached ? current.slug : slugify(name),
                  }));
                }}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="block text-sm font-semibold text-foreground-secondary">
              {t('admin.organizations.create.slug')}
              <input
                required
                minLength={3}
                maxLength={50}
                pattern="[a-z0-9-]+"
                value={form.slug}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    slug: slugify(event.target.value),
                    slugDetached: true,
                  }))
                }
                className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
          </div>
          <div className="mt-5 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? t('admin.organizations.edit.saving') : t('admin.organizations.edit.save')}
            </button>
            <Link
              href="/admin/organizations"
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background"
            >
              {t('admin.organizations.edit.cancel')}
            </Link>
          </div>
        </form>
      )}
    </main>
  );
}
