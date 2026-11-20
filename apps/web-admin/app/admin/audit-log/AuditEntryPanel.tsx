'use client';

import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { PayloadNode } from '../../../src/components/PayloadCell';
import { type AuditLogEntry, outcomeFacts } from './audit-entry';
import { ResultMark } from './AuditLogTable';
import { EntryPanelFrame, PanelField } from './EntryPanelFrame';
import type { EntrySelectionState } from './use-entry-selection';

/**
 * One audit row in full (ruling 911): what the row stores, laid out. A failed system action shows
 * only what it recorded, its exit code and its timeout: it keeps no error text (ruling 913).
 */
export function AuditEntryPanel({ selection }: { selection: EntrySelectionState<AuditLogEntry> }) {
  const { t, locale } = useI18n();
  const entry = selection.entry;

  return (
    <EntryPanelFrame
      selection={selection}
      title={<span className="font-mono text-base">{entry?.action}</span>}
    >
      {entry && (
        <dl>
          <PanelField label={t('admin.log.panel.when')}>
            {new Date(entry.created_at).toLocaleString(localeToBcp47(locale), {
              dateStyle: 'full',
              timeStyle: 'medium',
            })}
          </PanelField>
          <PanelField label={t('admin.log.panel.who')}>
            <WhoLine entry={entry} />
          </PanelField>
          <PanelField label={t('admin.auditLog.panel.target')}>
            <p>{entry.entityLabel ?? entry.entity_type}</p>
            <p className="select-all font-mono text-xs text-muted">
              {entry.entity_type} · {entry.entity_id}
            </p>
          </PanelField>
          {entry.outcome && (
            <PanelField label={t('admin.auditLog.panel.result')}>
              <ResultLine outcome={entry.outcome} payload={entry.payload_json} />
            </PanelField>
          )}
          <PanelField label={t('admin.auditLog.panel.fields')}>
            {isRecord(entry.payload_json) && Object.keys(entry.payload_json).length > 0 ? (
              <PayloadNode node={entry.payload_json} path={[]} labels={entry.payloadLabels ?? {}} />
            ) : (
              <span className="text-muted">{t('admin.auditLog.panel.noFields')}</span>
            )}
          </PanelField>
        </dl>
      )}
    </EntryPanelFrame>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function WhoLine({ entry }: { entry: AuditLogEntry }) {
  const { t } = useI18n();
  if (!entry.actor_user_id)
    return <span className="text-muted">{t('admin.log.panel.nobody')}</span>;
  return (
    <>
      <p>{entry.actorName ?? entry.actorEmail ?? t('admin.common.unknownUser')}</p>
      {entry.actorName && entry.actorEmail && (
        <p className="font-mono text-xs text-muted">{entry.actorEmail}</p>
      )}
    </>
  );
}

function ResultLine({
  outcome,
  payload,
}: {
  outcome: NonNullable<AuditLogEntry['outcome']>;
  payload: unknown;
}) {
  const { t } = useI18n();
  const { exitCode, timedOut } = outcomeFacts(payload);
  const facts = [
    exitCode === null ? null : t('admin.auditLog.panel.exitCode', { code: exitCode }),
    timedOut ? t('admin.auditLog.panel.timedOut') : null,
  ].filter((fact): fact is string => fact !== null);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <ResultMark outcome={outcome} />
      {facts.length > 0 && <span className="text-foreground-secondary">{facts.join(' · ')}</span>}
    </span>
  );
}
