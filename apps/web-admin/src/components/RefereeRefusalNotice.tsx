'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { RefereeReasons } from '@/components/RefereeReasons';
import type { RefereeWrite } from '@/hooks/useRefereeWrite';
import type { RefereeRefusal } from '@/lib/referee-reasons';

/** What a `useRefereeWrite` has to say: its refusal, its failure, or its note. */
export function RefereeWriteNotice({ write }: { write: RefereeWrite }) {
  if (write.refusal) {
    return (
      <RefereeRefusalNotice
        refusal={write.refusal}
        busy={write.busy}
        onConfirm={write.confirm}
        onDismiss={write.dismiss}
      />
    );
  }
  if (write.error) return <p className="text-sm text-danger">{write.error}</p>;
  if (write.note) return <p className="text-sm text-muted">{write.note}</p>;
  return null;
}

/**
 * A referee write the one checker refused (ADR-016), on a screen with no picker to show
 * the verdict before the pick: the Pools page's per-bout and Pool-strip dropdowns, the
 * bracket override. Red: the reasons, nothing to press but Cancel. Amber: the reasons and
 * "Assign anyway", which sends the same write again with `confirm: true`.
 */
export function RefereeRefusalNotice({
  refusal,
  busy,
  onConfirm,
  onDismiss,
}: {
  refusal: RefereeRefusal;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const red = refusal.level === 'impossible';
  return (
    <div
      role="alert"
      className={[
        'border rounded-xl px-4 py-3 text-sm',
        red ? 'bg-danger/10 border-danger/30' : 'bg-warning/10 border-warning/30',
      ].join(' ')}
    >
      <p className={`font-bold mb-1 ${red ? 'text-danger' : 'text-warning'}`}>
        {red
          ? t('organizer.refereeBoard.refusedImpossible')
          : t('organizer.refereeBoard.refusedDiscouraged')}
      </p>
      <RefereeReasons reasons={refusal.reasons} />
      <div className="mt-2 flex gap-2">
        {!red && (
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded border border-warning px-2 py-0.5 text-xs font-semibold text-warning hover:bg-warning/10 disabled:opacity-50"
          >
            {t('organizer.refereeBoard.pickAnyway')}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-50"
        >
          {t('organizer.refereeBoard.cancel')}
        </button>
      </div>
    </div>
  );
}
