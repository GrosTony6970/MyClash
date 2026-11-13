'use client';

import { useId, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { Button } from '@myclash/ui';
import { Field, inputClass, WeaponBoxes } from '@/components/fightbook/AskSparFields';

function usePostForm(
  catalog: string[],
  onPost: (weapons: string[], time: string) => Promise<boolean>,
) {
  const [weapons, setWeapons] = useState<string[]>([]);
  const [time, setTime] = useState('');
  const toggle = (name: string) =>
    setWeapons((now) => (now.includes(name) ? now.filter((w) => w !== name) : [...now, name]));
  const send = async () => {
    // In catalog order, as the ask sends them.
    const ok = await onPost(
      catalog.filter((w) => weapons.includes(w)),
      time,
    );
    if (ok) {
      setWeapons([]);
      setTime('');
    }
  };
  return { weapons, time, setTime, toggle, send };
}

/**
 * Post an open call: one to five weapons and a time today, `HH:MM` on the Event's clock (the
 * input posts exactly that). Sent once at a time; the form clears only when the call went through.
 */
export function PostOpenCall(props: {
  catalog: string[];
  posting: boolean;
  onPost: (weapons: string[], time: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const id = useId();
  const { weapons, time, setTime, toggle, send } = usePostForm(props.catalog, props.onPost);
  return (
    <form
      className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h3 className="text-sm font-semibold text-foreground">
        {t('publicApp.fightBook.floor.postTitle')}
      </h3>
      <WeaponBoxes catalog={props.catalog} picked={weapons} onToggle={toggle} />
      <Field label={t('publicApp.fightBook.floor.postTime')} htmlFor={`${id}-time`}>
        <input
          id={`${id}-time`}
          type="time"
          className={inputClass}
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        className="mt-3 min-h-11 self-start"
        disabled={props.posting || weapons.length === 0 || time === ''}
      >
        {t('publicApp.fightBook.floor.postSend')}
      </Button>
    </form>
  );
}
