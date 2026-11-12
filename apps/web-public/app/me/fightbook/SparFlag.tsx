'use client';

import { useId, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { KnownTranslationKey } from '@myclash/i18n';
import { SPAR_FLAG_REASONS, type AgreedSpar, type SparFlagReason } from '@myclash/types';
import { Button } from '@myclash/ui';
import type { FlagInput } from './use-spar-after';

const TEXT_BOX =
  'mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent';

/** Whole keys, one per reason, so the i18n sweep sees each one used. */
const REASON_KEYS: Record<SparFlagReason, KnownTranslationKey> = {
  too_hard: 'common.fightBookFlagReason.too_hard',
  equipment: 'common.fightBookFlagReason.equipment',
  disrespect: 'common.fightBookFlagReason.disrespect',
  other: 'common.fightBookFlagReason.other',
};

/** The four reasons as a radio group. */
function ReasonPicker(props: {
  value: SparFlagReason | null;
  onChange: (reason: SparFlagReason) => void;
}) {
  const { t } = useI18n();
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-semibold text-foreground">
        {t('publicApp.fightBook.flag.reasonLabel')}
      </legend>
      {SPAR_FLAG_REASONS.map((code) => (
        <label key={code} className="flex items-center gap-2 text-foreground">
          <input
            type="radio"
            name={name}
            value={code}
            checked={props.value === code}
            onChange={() => props.onChange(code)}
          />
          {t(REASON_KEYS[code])}
        </label>
      ))}
    </fieldset>
  );
}

/** The reason, a few words, who reads it, Send. Send waits for a reason and some words. */
function FlagForm(props: {
  spar: AgreedSpar;
  busy: boolean;
  onSend: (flag: FlagInput) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState<SparFlagReason | null>(null);
  const [text, setText] = useState('');
  const partner = props.spar.partner.name || t('publicApp.fightBook.unknownFighter');
  const who =
    props.spar.kind === 'event'
      ? t('publicApp.fightBook.flag.whoReadsEvent', { partner })
      : t('publicApp.fightBook.flag.whoReadsFree', { partner });
  const words = text.trim();
  return (
    <div className="mt-2 flex flex-col gap-2">
      <ReasonPicker value={reason} onChange={setReason} />
      <label className="text-foreground">
        {t('publicApp.fightBook.flag.textLabel')}
        <textarea
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={TEXT_BOX}
        />
      </label>
      <p className="text-muted">{who}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={props.busy || reason === null || words === ''}
          onClick={() => reason !== null && props.onSend({ reason, text: words })}
        >
          {t('publicApp.fightBook.flag.send')}
        </Button>
        <Button type="button" variant="outline" disabled={props.busy} onClick={props.onCancel}>
          {t('publicApp.fightBook.flag.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Under a card from the spar day on: one quiet link to report a safety problem, then the form.
 * Once sent (or already flagged), only the line saying who has it. The words follow the spar's
 * `kind`, never where the alert went. A refusal is said by `SparAfter`, and the form is kept.
 */
export function SparFlag(props: {
  spar: AgreedSpar;
  busy: boolean;
  onSend: (flag: FlagInput) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (props.spar.iFlagged) {
    return (
      <p className="mt-2 text-muted">
        {props.spar.kind === 'event'
          ? t('publicApp.fightBook.flag.doneEvent')
          : t('publicApp.fightBook.flag.doneFree')}
      </p>
    );
  }
  if (!open) {
    return (
      <div className="mt-2">
        <Button type="button" variant="ghost" disabled={props.busy} onClick={() => setOpen(true)}>
          {t('publicApp.fightBook.flag.link')}
        </Button>
      </div>
    );
  }
  return (
    <FlagForm
      spar={props.spar}
      busy={props.busy}
      onSend={(flag) => void props.onSend(flag)}
      onCancel={() => setOpen(false)}
    />
  );
}
