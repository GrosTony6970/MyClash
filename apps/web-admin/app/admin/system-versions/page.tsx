'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';

type VersionSource = 'manifest' | 'package.json' | 'compose' | 'runtime' | 'deploy';
type VersionStatus = 'ok' | 'unknown';

interface VersionComponent {
  key: string;
  label: string;
  version: string;
  source: VersionSource;
  status?: VersionStatus;
}

interface VersionGroup {
  key: string;
  label: string;
  components: VersionComponent[];
}

interface SystemVersionsResponse {
  generatedAt: string;
  deploy: {
    previousCommit: string;
    deployedCommit: string;
    deployedAt: string;
    deployedBy: string;
    backupFile: string;
  };
  groups: VersionGroup[];
}

export default function AdminSystemVersionsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [versions, setVersions] = useState<SystemVersionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/system-versions`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError(t('admin.systemVersions.accessDenied'));
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(t('admin.systemVersions.loadError'));
        const data = (await res.json()) as SystemVersionsResponse;
        if (!cancelled) {
          setVersions(data);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.systemVersions.loadError'));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, t]);

  return (
    <main id="main-content" className="p-8">
      <div className="mb-2">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">
          {t('admin.systemVersions.backToAdmin')}
        </Link>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('admin.systemVersions.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('admin.systemVersions.description')}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">{t('admin.systemVersions.loading')}</p>
      ) : versions ? (
        <>
          <div className="mb-5 text-sm text-gray-500">
            <span className="font-medium text-gray-700">
              {t('admin.systemVersions.generatedAt')}
            </span>{' '}
            {formatValue(versions.generatedAt, t('admin.systemVersions.unknown'))}
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            {versions.groups.map((group) => (
              <section
                key={group.key}
                className="border border-gray-200 rounded-lg overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h2 className="text-base font-semibold text-gray-950">
                    {translateWithFallback(
                      t,
                      `admin.systemVersions.groups.${group.key}`,
                      group.label,
                    )}
                  </h2>
                </div>
                {group.components.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-gray-400">
                    {t('admin.systemVersions.noComponents')}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-gray-500">
                          <th className="py-2 px-4">{t('admin.systemVersions.component')}</th>
                          <th className="py-2 px-4">{t('admin.systemVersions.version')}</th>
                          <th className="py-2 px-4">{t('admin.systemVersions.source')}</th>
                          <th className="py-2 px-4">{t('admin.systemVersions.status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.components.map((component) => (
                          <tr
                            key={`${group.key}-${component.key}`}
                            className="border-b border-gray-50 last:border-0"
                          >
                            <td className="py-2 px-4 text-gray-800">
                              {translateWithFallback(
                                t,
                                `admin.systemVersions.components.${component.key}`,
                                component.label,
                              )}
                            </td>
                            <td className="py-2 px-4 font-mono text-xs text-gray-700">
                              {formatValue(component.version, t('admin.systemVersions.unknown'))}
                            </td>
                            <td className="py-2 px-4">
                              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                                {component.source}
                              </span>
                            </td>
                            <td className="py-2 px-4">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                  component.status === 'unknown'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-green-100 text-green-700'
                                }`}
                              >
                                {t(`admin.systemVersions.statuses.${component.status ?? 'ok'}`)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}

function translateWithFallback(t: (key: string) => string, key: string, fallback: string): string {
  const translated = t(key);
  return translated === `[${key}]` ? fallback : translated;
}

function formatValue(value: string, unknownLabel: string): string {
  return value === 'unknown' ? unknownLabel : value;
}
