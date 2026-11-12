'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SparFlagListItem, SparFlagPage } from '@myclash/types';
import { apiRequest, failureMessage, type ApiFailure } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { errorOutcome, type Outcome } from '@/components/PageAlert';
import { flagsPagePath, type FlagScope } from './spar-flag-paths';
import { useHandledMarks } from './useHandledMarks';

/** A 403 reaches the web as `unauthenticated`: test the status, never send anyone to sign in. */
const isForbidden = (r: ApiFailure) => r.kind === 'unauthenticated' && r.status === 403;

function refusalText(
  kind: FlagScope['kind'],
  r: ApiFailure,
  t: ReturnType<typeof useI18n>['t'],
  fallback: string,
): string {
  if (!isForbidden(r)) return failureMessage(r, t, fallback) ?? '';
  return t(
    kind === 'club' ? 'admin.fightBookFlags.clubAdminsOnly' : 'admin.common.accessDeniedSuperAdmin',
  );
}

/**
 * The safety reports of one scope: the first page, "Show more", and the Handled mark (see
 * `useHandledMarks` for its race). "Show more" appends by id and keeps a row already held, so a
 * page landing mid-write never undoes an optimistic tick.
 */
export function useSparFlags(scope: FlagScope) {
  const { t } = useI18n();
  const [items, setItems] = useState<SparFlagListItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [nextPage, setNextPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const refuse = useCallback(
    (r: ApiFailure, fallback: string) =>
      setOutcome(errorOutcome(refusalText(scope.kind, r, t, fallback))),
    [scope.kind, t],
  );

  const orgId = scope.kind === 'club' ? scope.orgId : null;
  useEffect(() => {
    const controller = new AbortController();
    const read: FlagScope = orgId === null ? { kind: 'platform' } : { kind: 'club', orgId };
    void apiRequest<SparFlagPage>(getPublicApiUrl(), flagsPagePath(read, 0), {
      signal: controller.signal,
    }).then((r) => {
      if (controller.signal.aborted) return;
      if (!r.ok) return refuse(r, t('admin.fightBookFlags.loadFailed'));
      setItems(r.data.items);
      setMore(r.data.more);
    });
    return () => controller.abort();
  }, [orgId, refuse, t]);

  const showMore = useCallback(async () => {
    setLoadingMore(true);
    const r = await apiRequest<SparFlagPage>(getPublicApiUrl(), flagsPagePath(scope, nextPage));
    setLoadingMore(false);
    if (!r.ok) return refuse(r, t('admin.fightBookFlags.loadFailed'));
    setItems((held) => {
      const have = new Set((held ?? []).map((i) => i.id));
      return [...(held ?? []), ...r.data.items.filter((i) => !have.has(i.id))];
    });
    setMore(r.data.more);
    setNextPage(nextPage + 1);
  }, [scope, nextPage, refuse, t]);

  const { marking, setHandled } = useHandledMarks(scope, setItems, setOutcome);

  return { items, more, loadingMore, marking, outcome, showMore, setHandled };
}
