'use client';

import { Button, Modal, statusPillTone } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import {
  isOutstanding,
  readinessLabelKey,
  readinessMessageKey,
  readinessSemantic,
  type ReadinessCheck,
  type ReadinessReport,
} from '../readiness-copy';

interface Props {
  open: boolean;
  report: ReadinessReport;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Shown before publishing when readiness has anything outstanding.
 *
 * It WARNS, it does not gate — "Publish anyway" is always the primary action.
 * Publishing an event before its referees are assigned is normal practice:
 * organisers publish to open registration weeks before staffing exists. The
 * dialog exists so nobody discovers on the morning that three pools have no
 * referee, not to argue with them about when to publish.
 */
export function PublishReadinessDialog({ open, report, busy, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  const outstanding = report.checks.filter(isOutstanding);
  const nameById = new Map(
    report.tournaments.map((tournament) => [tournament.id, tournament.name]),
  );

  return (
    <Modal
      open={open}
      onClose={onCancel}
      busy={busy}
      size="lg"
      title={t('organizer.readiness.publishTitle')}
      description={t('organizer.readiness.publishDescription', { count: outstanding.length })}
      footer={
        <>
          <Button variant="cancel" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={busy}>
            {t('organizer.readiness.publishAnyway')}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-border rounded-md border border-border">
        {outstanding.map((check) => (
          <OutstandingRow
            key={`${check.tournamentId ?? 'event'}-${check.key}`}
            check={check}
            tournamentName={check.tournamentId ? (nameById.get(check.tournamentId) ?? null) : null}
          />
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">{t('organizer.readiness.publishHint')}</p>
    </Modal>
  );
}

function OutstandingRow({
  check,
  tournamentName,
}: {
  check: ReadinessCheck;
  tournamentName: string | null;
}) {
  const { t } = useI18n();
  const label = t(readinessLabelKey(check));
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span
        className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border ${
          statusPillTone(readinessSemantic(check.level), 'light').className
        }`}
        role="img"
        aria-label={t(`organizer.readiness.level.${check.level}`)}
      />
      <span className="font-medium text-foreground">
        {tournamentName ? `${tournamentName} — ${label}` : label}
      </span>
      <span className="min-w-0 flex-1 text-muted">
        {t(readinessMessageKey(check), check.values ?? {})}
      </span>
    </li>
  );
}
