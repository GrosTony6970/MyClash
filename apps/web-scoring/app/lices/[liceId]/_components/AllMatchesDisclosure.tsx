'use client';

import { useState } from 'react';
import { CollapsibleSection } from '@myclash/ui';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import type { LiceMatch } from '../../../../src/components/lice-match-types';
import { LiceMatchCard } from './LiceMatchCard';

/**
 * The piste's whole day, behind one tap.
 *
 * Collapsed by default: the operator's usual question is "what am I scoring and
 * what's after it", which LIVE and NEXT already answer. This is for the other
 * question — "what happened earlier / what does the rest of the day look like"
 * — which the old screen could not answer at all, because the endpoint filtered
 * completed bouts out entirely.
 */
export function AllMatchesDisclosure({ matches }: { matches: LiceMatch[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <CollapsibleSection
      open={open}
      onToggle={() => setOpen((value) => !value)}
      headerClassName="min-h-[44px] rounded-xl border border-border bg-surface px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted hover:border-muted"
      bodyClassName="mt-2 flex flex-col gap-2"
      header={t('scoring.lice.allMatches', { count: matches.length })}
    >
      {matches.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          {t('scoring.lice.allMatchesEmpty')}
        </p>
      ) : (
        matches.map((match) => <LiceMatchCard key={match.id} match={match} compact />)
      )}
    </CollapsibleSection>
  );
}
