'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { Button } from '@myclash/ui';
import { AskSparDialog } from './AskSparDialog';

/**
 * The "Ask to spar" button and the dialog it opens. The caller has already learned that this
 * fighter is askable; on any other answer it renders no button at all.
 */
export function AskToSpar(props: {
  receiverGlobalPersonId: string;
  name: string;
  eventId?: string;
  apiUrl: string;
  onSent?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" className="min-h-11" onClick={() => setOpen(true)}>
        {t('publicApp.fightBook.ask.button')}
      </Button>
      {open ? (
        <AskSparDialog
          receiverGlobalPersonId={props.receiverGlobalPersonId}
          name={props.name}
          eventId={props.eventId}
          apiUrl={props.apiUrl}
          onClose={() => setOpen(false)}
          onSent={props.onSent}
        />
      ) : null}
    </>
  );
}
