'use client';

import { Button, FormField } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import {
  useRosterMessage,
  type RosterMessageOutcome,
  type RosterMessageTarget,
} from './roster-message';

/**
 * "Message the people booked" under a session's roster (operator ruling 530). The page shows it
 * only for a session that runs and has someone booked or waiting (532). On an archived Event, Send
 * is greyed, as Remove is: the server refuses the message there. While the roster is read again
 * (after a Remove or a Promote) the box stays, with what was typed, but Send waits: the question
 * would count the people as they were before.
 */
export function RosterMessage({
  readOnly,
  rereading,
  ...target
}: RosterMessageTarget & { readOnly: boolean; rereading: boolean }) {
  const { t } = useI18n();
  const message = useRosterMessage(target);

  return (
    <section className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">{t('organizer.workshopsPage.message.heading')}</h3>
      <FormField
        label={t('organizer.workshopsPage.message.titleLabel')}
        value={message.title}
        maxLength={120}
        onChange={(e) => message.setTitle(e.target.value)}
      />
      <FormField
        multiline
        rows={3}
        label={t('organizer.workshopsPage.message.bodyLabel')}
        value={message.body}
        maxLength={1000}
        onChange={(e) => message.setBody(e.target.value)}
      />
      <OutcomeLine outcome={message.outcome} />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={readOnly || rereading || !message.ready}
          title={readOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
          onClick={() => void message.send()}
        >
          {message.busy
            ? t('organizer.workshopsPage.message.sending')
            : t('organizer.workshopsPage.message.send')}
        </Button>
      </div>
    </section>
  );
}

/** What became of the last Send: a status a screen reader says, or an alert. */
function OutcomeLine({ outcome }: { outcome: RosterMessageOutcome }) {
  const { t } = useI18n();
  if (!outcome) return null;
  if ('error' in outcome) {
    return (
      <p role="alert" className="text-sm text-danger">
        {outcome.error}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-success">
      {t('organizer.workshopsPage.message.sent', { count: outcome.sent })}
    </p>
  );
}
