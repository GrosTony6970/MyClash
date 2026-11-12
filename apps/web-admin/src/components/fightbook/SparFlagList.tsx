'use client';

import type { SparFlagListItem } from '@myclash/types';
import { Button } from '@myclash/ui';
import { formatDate, localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { PageAlert } from '@/components/PageAlert';
import type { FlagScope } from './spar-flag-paths';
import { useSparFlags } from './useSparFlags';

type Locale = Parameters<typeof localeToBcp47>[0];

// Whole literal keys, so the i18n sweep sees each reason label.
const REASON_KEYS: Record<SparFlagListItem['reason'], string> = {
  too_hard: 'common.fightBookFlagReason.too_hard',
  equipment: 'common.fightBookFlagReason.equipment',
  disrespect: 'common.fightBookFlagReason.disrespect',
  other: 'common.fightBookFlagReason.other',
};

/** A spar's calendar day (`YYYY-MM-DD`) as the reader writes it: zone-free, so read in UTC. */
function dayLabel(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * The safety reports of one scope, newest first: the club's own, or the whole platform's. Shared
 * by `/org/[slug]/fightbook-flags` and `/admin/fightbook-flags`.
 */
export function SparFlagList({ scope }: { scope: FlagScope }) {
  const { t } = useI18n();
  const flags = useSparFlags(scope);
  return (
    <div className="space-y-4">
      <PageAlert outcome={flags.outcome} />
      {flags.items && flags.items.length === 0 && (
        <p className="text-sm text-muted">{t('admin.fightBookFlags.empty')}</p>
      )}
      {flags.items && flags.items.length > 0 && (
        <ul className="space-y-3">
          {flags.items.map((item) => (
            <SparFlagRow
              key={item.id}
              item={item}
              showClub={scope.kind === 'platform'}
              busy={flags.marking.has(item.id)}
              onHandled={(handled) => void flags.setHandled(item.id, handled)}
            />
          ))}
        </ul>
      )}
      {flags.more && (
        <Button
          variant="secondary"
          size="sm"
          disabled={flags.loadingMore}
          onClick={() => void flags.showMore()}
        >
          {t('admin.fightBookFlags.showMore')}
        </Button>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function SparFlagRow({
  item,
  showClub,
  busy,
  onHandled,
}: {
  item: SparFlagListItem;
  showClub: boolean;
  busy: boolean;
  onHandled: (handled: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const where = item.eventName ?? item.place;
  return (
    <li className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{t(REASON_KEYS[item.reason])}</p>
        <p className="text-xs text-muted">{formatDate(item.createdAt, locale)}</p>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.text}</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t('admin.fightBookFlags.reportedBy')}>
          {item.reporter?.name ?? t('admin.fightBookFlags.erasedAccount')}
        </Detail>
        <Detail label={t('admin.fightBookFlags.flagged')}>{item.flagged.name}</Detail>
        <Detail label={t('admin.fightBookFlags.sparDay')}>{dayLabel(item.day, locale)}</Detail>
        {where && <Detail label={t('admin.fightBookFlags.where')}>{where}</Detail>}
        {item.weapons.length > 0 && (
          <Detail label={t('admin.fightBookFlags.weapons')}>{item.weapons.join(', ')}</Detail>
        )}
        {showClub && item.club && (
          <Detail label={t('admin.fightBookFlags.club')}>{item.club}</Detail>
        )}
      </dl>
      <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={item.handled}
          disabled={busy}
          onChange={(e) => onHandled(e.target.checked)}
        />
        {t('admin.fightBookFlags.handled')}
      </label>
    </li>
  );
}
