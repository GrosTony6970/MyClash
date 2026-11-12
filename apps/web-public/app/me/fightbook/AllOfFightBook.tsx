'use client';

import { useId, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { Button, Spinner } from '@myclash/ui';
import { Field, inputClass } from '@/components/fightbook/AskSparFields';
import { ReadFailed } from '@/components/me/ReadFailed';
import { FindCards } from './FindCards';
import { useFightBookBrowse, useNameFilter } from './use-fightbook-browse';

interface BrowseProps {
  apiUrl: string;
  weapon: string;
  onSent: () => void;
  onHearted?: (globalPersonId: string, favourite: boolean) => void;
}

/**
 * "All of FightBook" (ruling 675): every FightBook user, by name, 20 a page with "Show more". A
 * name box narrows it once typing pauses; the weapon filter above narrows it too.
 */
export function AllOfFightBook(props: BrowseProps) {
  const { t } = useI18n();
  const id = useId();
  const [text, setText] = useState('');
  const name = useNameFilter(text);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.fightBook.find.all')}
      </h2>
      <Field label={t('publicApp.fightBook.find.name')} htmlFor={`${id}-name`}>
        <input
          id={`${id}-name`}
          type="search"
          maxLength={80}
          className={inputClass}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <BrowsePages {...props} name={name} />
    </section>
  );
}

function BrowsePages(props: BrowseProps & { name: string }) {
  const { t } = useI18n();
  const browse = useFightBookBrowse(props.apiUrl, props.name, props.weapon);
  return (
    <>
      {browse.items?.length === 0 ? (
        <p className="text-sm text-muted">{t('publicApp.fightBook.find.browseEmpty')}</p>
      ) : null}
      {browse.items ? (
        <FindCards
          cards={browse.items}
          apiUrl={props.apiUrl}
          onSent={props.onSent}
          onHearted={props.onHearted}
        />
      ) : null}
      {browse.failed ? (
        <ReadFailed title={t('publicApp.fightBook.find.browseFailed')} onRetry={browse.retry} />
      ) : null}
      {browse.loading ? <Spinner label={t('common.loading')} /> : null}
      {browse.more ? (
        <Button type="button" variant="outline" className="min-h-11" onClick={browse.showMore}>
          {t('publicApp.fightBook.find.more')}
        </Button>
      ) : null}
    </>
  );
}
