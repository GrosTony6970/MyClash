'use client';

import { useState } from 'react';
import { useI18n } from '../../../../src/i18n/I18nProvider';
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
        className="mt-3 text-xs font-semibold text-amber-400 underline-offset-4 hover:underline"
      >
        {t('publicApp.fighterProfile.matchHistoryShowAll')} →
      </button>
      {open && <MatchHistoryModal slug={slug} apiUrl={apiUrl} onClose={() => setOpen(false)} />}
    </>
  );
}
