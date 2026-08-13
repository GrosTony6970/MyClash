'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { MatchHistoryModal } from './MatchHistoryModal';

interface Props {
  slug: string;
  apiUrl: string;
}

export function MatchHistoryTrigger({ slug, apiUrl }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-xs font-semibold text-accent underline-offset-4 hover:underline"
      >
        {t('publicApp.fighterProfile.matchHistoryShowAll')} →
      </button>
      {open && <MatchHistoryModal slug={slug} apiUrl={apiUrl} onClose={() => setOpen(false)} />}
    </>
  );
}
