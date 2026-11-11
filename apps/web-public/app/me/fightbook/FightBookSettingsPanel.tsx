'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { FightBookBlock, SparFighter } from '@myclash/types';
import { Avatar, Button, Switch } from '@myclash/ui';
import { writeFightBook } from '@/lib/fightbook/read-fightbook';
import { SettingRow } from '../settings/controls';

/**
 * The switch's save: the tap shows at once and is put back when the save fails, with a flag the
 * page says; a save that worked calls `onSaved` with what the server saved.
 */
function useSwitchSave(apiUrl: string, enabled: boolean, onSaved: (enabled: boolean) => void) {
  const [shown, setShown] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const save = async (next: boolean) => {
    setShown(next);
    setFailed(false);
    const res = await writeFightBook<{ enabled: boolean }>(
      apiUrl,
      '/api/v1/me/fightbook/settings',
      'PATCH',
      { enabled: next },
    );
    if (res.ok) {
      setShown(res.data.enabled);
      onSaved(res.data.enabled);
      return;
    }
    setShown(!next);
    setFailed(true);
  };
  return { shown, failed, save };
}

/** The FightBook switch, saved at once. */
export function FightBookSwitch(props: {
  apiUrl: string;
  enabled: boolean;
  onSaved: (enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const { shown, failed, save } = useSwitchSave(props.apiUrl, props.enabled, props.onSaved);
  return (
    <div>
      <SettingRow
        label={t('publicApp.fightBook.settings.enabled')}
        description={t('publicApp.fightBook.settings.enabledDescription')}
        control={
          <Switch
            checked={shown}
            onChange={(next) => void save(next)}
            ariaLabel={t('publicApp.fightBook.settings.enabled')}
          />
        }
      />
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {t('publicApp.fightBook.settings.saveFailed')}
        </p>
      ) : null}
    </div>
  );
}

function BlockedRow({ fighter, onUnblock }: { fighter: SparFighter; onUnblock: () => void }) {
  const { t } = useI18n();
  const name = fighter.name || t('publicApp.fightBook.unknownFighter');
  return (
    <li className="flex items-center gap-3">
      <Avatar name={name} src={fighter.photoUrl ?? undefined} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{name}</span>
      <Button type="button" variant="outline" className="min-h-11" onClick={onUnblock}>
        {t('publicApp.fightBook.settings.unblock')}
      </Button>
    </li>
  );
}

/** The fighters I blocked, each with Unblock. Only the blocker ever sees a block. */
function BlockedFighters(props: {
  apiUrl: string;
  blocks: FightBookBlock[];
  onUnblocked: (globalPersonId: string) => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const unblock = async (id: string) => {
    setFailed(false);
    const res = await writeFightBook(props.apiUrl, `/api/v1/me/fightbook/blocks/${id}`, 'DELETE');
    if (res.ok) props.onUnblocked(id);
    else setFailed(true);
  };
  return (
    <>
      <h3 className="mt-4 text-sm font-semibold text-foreground">
        {t('publicApp.fightBook.settings.blockedHeading')}
      </h3>
      <p className="mt-0.5 text-xs leading-5 text-muted">
        {t('publicApp.fightBook.settings.blockedDescription')}
      </p>
      {props.blocks.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('publicApp.fightBook.settings.blockedEmpty')}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {props.blocks.map(({ fighter }) => (
            <BlockedRow
              key={fighter.globalPersonId}
              fighter={fighter}
              onUnblock={() => void unblock(fighter.globalPersonId)}
            />
          ))}
        </ul>
      )}
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {t('publicApp.fightBook.settings.unblockFailed')}
        </p>
      ) : null}
    </>
  );
}

/** The switch and the fighters I blocked. */
export function FightBookSettingsPanel(props: {
  apiUrl: string;
  blocks: FightBookBlock[];
  onSwitched: () => void;
  onUnblocked: (globalPersonId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.fightBook.settings.heading')}
      </h2>
      <FightBookSwitch apiUrl={props.apiUrl} enabled onSaved={props.onSwitched} />
      <BlockedFighters
        apiUrl={props.apiUrl}
        blocks={props.blocks}
        onUnblocked={props.onUnblocked}
      />
    </section>
  );
}
