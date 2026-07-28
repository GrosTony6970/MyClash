'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { RulesetDiscoverCard, type RulesetDiscoverCardProps } from './RulesetDiscoverCard';
import { getPublicApiUrl } from '../../lib/api-url';

/** One catalog card's data — the card props plus a stable key. */
export type DiscoverCardData = RulesetDiscoverCardProps & { id: string };

const apiUrl = getPublicApiUrl();

/**
 * Generic Discover catalog tab: fetches an org catalog endpoint and renders the
 * adoptable rulesets as cards. The scoring and penalty pages differ only in the
 * endpoint and how a raw row maps to a card, so both pass `toCards` and reuse
 * this fetch/loading/empty shell.
 */
export function RulesetDiscoverTab({
  endpoint,
  toCards,
}: {
  endpoint: string;
  toCards: (rows: unknown[]) => DiscoverCardData[];
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch(`${apiUrl}${endpoint}`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.rulesets.discover.loadError'));
        return (await res.json()) as unknown[];
      })
      .then((data) => {
        if (!cancelled) setRows(data ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.rulesets.discover.loadError'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint, t]);

  if (loading) return <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>;
  if (error)
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
        {error}
      </div>
    );

  const cards = toCards(rows);
  if (cards.length === 0)
    return <p className="text-sm text-muted">{t('admin.rulesets.discover.empty')}</p>;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(({ id, ...card }) => (
        <RulesetDiscoverCard key={id} {...card} />
      ))}
    </div>
  );
}
